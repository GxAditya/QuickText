// content_script.js for Firefox
console.log("QuickText content script loaded.");

let snippets = [];
let hotkeySnippets = [];
let isExpanding = false; // Flag to prevent re-expansion during editing
let recentlyExpanded = new Map(); // Track recently expanded content with timestamps

// Function to sanitize HTML content to prevent XSS attacks
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString('<div></div>', 'text/html');
  const container = doc.body.firstChild;
  
  // Use DOMParser to parse the HTML safely
  const parsedDoc = new DOMParser().parseFromString(html, 'text/html');
  const sanitizedContent = parsedDoc.body;
  
  // Remove potentially dangerous elements and attributes
  const scripts = sanitizedContent.querySelectorAll('script, iframe, object, embed, form');
  scripts.forEach(node => node.remove());
  
  // Remove dangerous attributes (event handlers, javascript: URLs)
  const allElements = sanitizedContent.querySelectorAll('*');
  allElements.forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      // Remove on* event handlers and javascript: URLs
      if (attr.name.startsWith('on') || 
          (attr.value && attr.value.toLowerCase().includes('javascript:')) ||
          (attr.name === 'href' && attr.value.toLowerCase().includes('javascript:'))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  
  return sanitizedContent.innerHTML;
}

// Load snippets from storage
function loadSnippetsFromStorage() {
  browser.storage.local.get({ snippets: [], hotkey_snippets: [] }).then(result => {
    snippets = result.snippets.filter(s => !s.trigger.includes('+')); // Only text triggers for content script
    hotkeySnippets = result.hotkey_snippets || [];
    // console.log('QuickText: Text snippets loaded in content script:', snippets);
    // console.log('QuickText: Hotkey snippets loaded in content script:', hotkeySnippets);
  });
}

// Listen for changes in storage (e.g., when snippets are updated in options)
browser.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && (changes.snippets || changes.hotkey_snippets)) {
    loadSnippetsFromStorage();
  }
});

// Initial load
loadSnippetsFromStorage();

// Function to replace trigger text with snippet value
function expandSnippet(targetElement, trigger, value, isRichText = false) {
  if (!targetElement) return;

  // Check if this content was recently expanded to prevent loops
  const elementId = targetElement.id || targetElement.tagName + '_' + (targetElement.className || '');
  const now = Date.now();
  const recentExpansion = recentlyExpanded.get(elementId);
  
  // Clean up old entries (older than 2 seconds)
  for (const [key, expansion] of recentlyExpanded.entries()) {
    if (now - expansion.timestamp > 2000) {
      recentlyExpanded.delete(key);
    }
  }
  
  if (recentExpansion && (now - recentExpansion.timestamp) < 1000) {
    console.log('QuickText: Skipping expansion - content was recently expanded');
    return false;
  }

  if (targetElement.isContentEditable) {
    // Handle rich text in contentEditable elements
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      console.log('QuickText: No selection found in contentEditable');
      return false;
    }
    
    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    const textContent = textNode.textContent;
    const cursorPosition = range.startOffset;
    const textBeforeCursor = textContent.substring(0, cursorPosition);

    console.log('QuickText: ContentEditable analysis:', { textContent, cursorPosition, textBeforeCursor });

    // Find the last occurrence of the trigger before the cursor
    const triggerStartIndex = textBeforeCursor.lastIndexOf(trigger);

    if (triggerStartIndex !== -1 && textBeforeCursor.endsWith(trigger)) {
      console.log('QuickText: Expanding in contentEditable');
      // Create a range to delete the trigger text
      const deleteRange = document.createRange();
      deleteRange.setStart(textNode, triggerStartIndex);
      deleteRange.setEnd(textNode, cursorPosition);
      deleteRange.deleteContents();

      // Insert the snippet value
      if (isRichText) {
        // Insert as HTML for rich text with sanitization
        const parsedDoc = new DOMParser().parseFromString(sanitizeHTML(value), 'text/html');
        const fragment = document.createDocumentFragment();
        while (parsedDoc.body.firstChild) {
          fragment.appendChild(parsedDoc.body.firstChild);
        }
        range.insertNode(fragment);
      } else {
        // Insert as plain text
        const textNode = document.createTextNode(value);
        range.insertNode(textNode);
      }

      // Move cursor to end of inserted content
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      // Track this expansion
      recentlyExpanded.set(elementId, { timestamp: now, trigger, value });

      return true;
    } else {
      console.log('QuickText: Trigger not found at cursor position in contentEditable');
    }
  } else {
    // For regular input/textarea elements
    const originalValue = targetElement.value;
    const selectionStart = targetElement.selectionStart;
    const textBeforeCursor = originalValue.substring(0, selectionStart);

    // Find the last occurrence of the trigger before the cursor
    const triggerStartIndex = textBeforeCursor.lastIndexOf(trigger);

    if (triggerStartIndex !== -1 && textBeforeCursor.endsWith(trigger)) {
      console.log('QuickText: Expanding in input/textarea');
      const textAfterCursor = originalValue.substring(selectionStart);
      
      // Replace the trigger with the snippet value
      // For rich text in regular inputs, we'll just strip HTML tags
      let insertValue = value;
      if (isRichText) {
        // Simple HTML stripping for non-contentEditable fields
        const parsedDoc = new DOMParser().parseFromString(sanitizeHTML(value), 'text/html');
        insertValue = parsedDoc.body.textContent || '';
      }
      
      targetElement.value = textBeforeCursor.substring(0, triggerStartIndex) + insertValue + textAfterCursor;

      // Update cursor position
      const newCursorPosition = triggerStartIndex + insertValue.length;
      targetElement.setSelectionRange(newCursorPosition, newCursorPosition);

      // Dispatch input and change events to ensure the website reacts to the change
      targetElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      targetElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

      // Track this expansion
      recentlyExpanded.set(elementId, { timestamp: now, trigger, value });

      return true;
    } else {
      console.log('QuickText: Trigger not found at cursor position in input/textarea');
    }
  }
  return false;
}

// Function to check for text triggers in input/textarea fields
function checkForTextTriggers(event) {
  const targetElement = event.target;
  
  // Only process if we're in an editable field
  if (!targetElement || (!targetElement.isContentEditable && 
      targetElement.tagName !== 'INPUT' && targetElement.tagName !== 'TEXTAREA')) {
    return;
  }
  
  // Get the text before the cursor
  let textBeforeCursor = '';
  if (targetElement.isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        textBeforeCursor = textNode.textContent.substring(0, range.startOffset);
      }
    }
  } else {
    textBeforeCursor = targetElement.value.substring(0, targetElement.selectionStart);
  }
  
  console.log('QuickText: Input detected:', textBeforeCursor, 'in', targetElement.tagName, targetElement.id || 'no-id');
  console.log('QuickText: Available snippets:', snippets);
  
  // Check if any snippet trigger is at the end of the text before cursor
  for (const snippet of snippets) {
    if (textBeforeCursor.endsWith(snippet.trigger)) {
      console.log('QuickText: Trigger matched:', snippet.trigger, 'expanding to:', snippet.value);
      // Prevent default behavior for the current key press
      event.preventDefault();
      event.stopPropagation();
      
      // Expand the snippet with proper isRichText handling
      const isRichText = snippet.isRichText || false;
      if (expandSnippet(targetElement, snippet.trigger, snippet.value, isRichText)) {
        console.log('QuickText: Snippet expanded successfully');
        break;
      } else {
        console.log('QuickText: Failed to expand snippet');
      }
    }
  }
}

// Function to handle hotkey combinations
function handleHotkeyPress(event) {
  // Skip if we're not in an editable field
  const targetElement = event.target;
  if (!targetElement || (!targetElement.isContentEditable && 
      targetElement.tagName !== 'INPUT' && targetElement.tagName !== 'TEXTAREA')) {
    return;
  }
  
  // Build a string representation of the key combination
  const keyCombo = [];
  if (event.ctrlKey) keyCombo.push('Ctrl');
  if (event.altKey) keyCombo.push('Alt');
  if (event.shiftKey) keyCombo.push('Shift');
  if (event.metaKey) keyCombo.push('Meta'); // Command key on Mac
  
  // Add the actual key pressed (if it's not a modifier key)
  const key = event.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    keyCombo.push(key);
  }
  
  const keyComboString = keyCombo.join('+');
  
  // Check if this key combo matches any of our hotkey snippets
  const matchingSnippet = hotkeySnippets.find(s => s.trigger.toLowerCase() === keyComboString.toLowerCase());
  
  if (matchingSnippet) {
    // Prevent default behavior
    event.preventDefault();
    event.stopPropagation();
    
    // Expand the snippet
    const isRichText = matchingSnippet.value.includes('<') && matchingSnippet.value.includes('>');
    expandSnippet(targetElement, '', matchingSnippet.value, isRichText);
  }
}

// Listen for keydown events to detect hotkey combinations
document.addEventListener('keydown', handleHotkeyPress, true);

// Listen for input events to detect text triggers
document.addEventListener('input', checkForTextTriggers, true);

// Listen for messages from the background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_HOTKEY_SNIPPETS') {
    hotkeySnippets = message.snippets;
    return Promise.resolve({ success: true });
  } else if (message.type === 'EXPAND_HOTKEY_SNIPPET') {
    // Find the active element to expand the snippet in
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.isContentEditable || 
        activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      const isRichText = message.value.includes('<') && message.value.includes('>');
      const success = expandSnippet(activeElement, '', message.value, isRichText);
      return Promise.resolve({ success, message: success ? 'Snippet expanded' : 'Could not expand snippet' });
    } else {
      return Promise.resolve({ success: false, message: 'No suitable active element found' });
    }
  }
  return false;
});