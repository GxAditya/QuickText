// content_script.js
console.log("QuickText content script loaded.");

let snippets = [];
let hotkeySnippets = [];
let isExpanding = false; // Flag to prevent re-expansion during editing
let recentlyExpanded = new Map(); // Track recently expanded content with timestamps

// Function to sanitize HTML to prevent XSS attacks
function sanitizeHTML(html) {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

// Load snippets from storage
function loadSnippetsFromStorage() {
  chrome.storage.local.get({ snippets: [], hotkey_snippets: [] }, (result) => {
    snippets = result.snippets.filter(s => !s.trigger.includes('+')); // Only text triggers for content script
    hotkeySnippets = result.hotkey_snippets || [];
    // console.log('QuickText: Text snippets loaded in content script:', snippets);
    // console.log('QuickText: Hotkey snippets loaded in content script:', hotkeySnippets);
  });
}

// Listen for changes in storage (e.g., when snippets are updated in options)
chrome.storage.onChanged.addListener((changes, namespace) => {
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

    console.log('QuickText: Input/textarea analysis:', { originalValue, selectionStart, textBeforeCursor });

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

// Listen for input events on text fields
document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    const currentText = target.isContentEditable ? target.textContent : target.value;
    if (!currentText) return;

    console.log('QuickText: Input detected:', currentText, 'in', target.tagName, target.id || 'no-id');
    console.log('QuickText: Available snippets:', snippets);

    for (const snippet of snippets) {
      if (currentText.endsWith(snippet.trigger)) {
        console.log('QuickText: Trigger matched:', snippet.trigger, 'expanding to:', snippet.value);
        // Use the enhanced expandSnippet function that handles both plain and rich text
        if (expandSnippet(target, snippet.trigger, snippet.value, snippet.isRichText)) {
          console.log('QuickText: Snippet expanded successfully');
          break; // Snippet expanded, no need to check others
        } else {
          console.log('QuickText: Failed to expand snippet');
        }
      }
    }
  }
}, true); // Use capture phase to catch events early

// Track key combinations for hotkey support
let pressedKeys = new Set();

// Listen for keydown events to track pressed keys
document.addEventListener('keydown', (event) => {
  // Add the key to the set of pressed keys
  if (event.key === 'Control') pressedKeys.add('ctrl');
  else if (event.key === 'Alt') pressedKeys.add('alt');
  else if (event.key === 'Shift') pressedKeys.add('shift');
  else if (event.key === 'Meta') pressedKeys.add('meta'); // Command key on Mac
  else pressedKeys.add(event.key.toLowerCase());
  
  // Check if any hotkey combination matches
  for (const snippet of hotkeySnippets) {
    const hotkeyParts = snippet.trigger.toLowerCase().split('+');
    const allPartsPressed = hotkeyParts.every(part => pressedKeys.has(part.trim()));
    
    // If all parts of the hotkey are pressed and the number of pressed keys matches the hotkey parts
    if (allPartsPressed && pressedKeys.size === hotkeyParts.length) {
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        // Insert the snippet value
        if (activeElement.isContentEditable) {
          if (snippet.isRichText) {
            // Insert as HTML with sanitization
            const parsedDoc = new DOMParser().parseFromString(sanitizeHTML(snippet.value), 'text/html');
            const fragment = document.createDocumentFragment();
            while (parsedDoc.body.firstChild) {
              fragment.appendChild(parsedDoc.body.firstChild);
            }
            document.execCommand('insertNode', false, fragment);
          } else {
            // Insert as plain text
            document.execCommand('insertText', false, snippet.value);
          }
        } else {
          // For INPUT and TEXTAREA
          const start = activeElement.selectionStart;
          const end = activeElement.selectionEnd;
          
          // For rich text in regular inputs, strip HTML
          let insertValue = snippet.value;
          if (snippet.isRichText) {
            // Simple HTML stripping for non-contentEditable fields
            const parsedDoc = new DOMParser().parseFromString(sanitizeHTML(snippet.value), 'text/html');
            insertValue = parsedDoc.body.textContent || '';
          }
          
          activeElement.value = activeElement.value.substring(0, start) + 
                               insertValue + 
                               activeElement.value.substring(end);
          const newCursorPos = start + insertValue.length;
          activeElement.setSelectionRange(newCursorPos, newCursorPos);
          activeElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
        
        // Prevent default action
        event.preventDefault();
        break;
      }
    }
  }
}, true);

// Listen for keyup events to remove keys from the set
document.addEventListener('keyup', (event) => {
  if (event.key === 'Control') pressedKeys.delete('ctrl');
  else if (event.key === 'Alt') pressedKeys.delete('alt');
  else if (event.key === 'Shift') pressedKeys.delete('shift');
  else if (event.key === 'Meta') pressedKeys.delete('meta');
  else pressedKeys.delete(event.key.toLowerCase());
}, true);

// Listen for messages from background script (e.g., for hotkey-triggered expansions)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXPAND_HOTKEY_SNIPPET') {
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      // console.log('QuickText: Received hotkey expansion request for:', request.value);
      if (activeElement.isContentEditable) {
        // For contentEditable elements, insert HTML if value contains it, otherwise plain text
        if (request.isRichText) {
          // Insert as HTML with sanitization
          const parsedDoc = new DOMParser().parseFromString(sanitizeHTML(request.value), 'text/html');
          const fragment = document.createDocumentFragment();
          while (parsedDoc.body.firstChild) {
            fragment.appendChild(parsedDoc.body.firstChild);
          }
          document.execCommand('insertNode', false, fragment);
        } else {
          // Insert as plain text
          document.execCommand('insertText', false, request.value);
        }
      } else {
        // For INPUT and TEXTAREA, replace selection or insert at cursor
        const start = activeElement.selectionStart;
        const end = activeElement.selectionEnd;
        
        // For rich text in regular inputs, strip HTML
        let insertValue = request.value;
        if (request.isRichText) {
          // Simple HTML stripping for non-contentEditable fields
          const parsedDoc = new DOMParser().parseFromString(sanitizeHTML(request.value), 'text/html');
          insertValue = parsedDoc.body.textContent || '';
        }
        
        activeElement.value = activeElement.value.substring(0, start) + insertValue + activeElement.value.substring(end);
        const newCursorPos = start + insertValue.length;
        activeElement.setSelectionRange(newCursorPos, newCursorPos);
        activeElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      }
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, message: 'No active editable element found.' });
    }
    return true; // Indicates that the response will be sent asynchronously
  } else if (request.type === 'UPDATE_HOTKEY_SNIPPETS') {
    // Update the hotkey snippets from the background script
    hotkeySnippets = request.snippets || [];
    sendResponse({ success: true });
    return true;
  }
});