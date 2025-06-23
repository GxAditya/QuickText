document.addEventListener('DOMContentLoaded', () => {
  const snippetTriggerInput = document.getElementById('snippet-trigger');
  const snippetValueInput = document.getElementById('snippet-value');
  const addSnippetButton = document.getElementById('add-snippet-button');
  const snippetsTableBody = document.querySelector('#snippets-table tbody');
  const exportSnippetsButton = document.getElementById('export-snippets-button');
  const importSnippetsInput = document.getElementById('import-snippets-input');
  const importSnippetsButton = document.getElementById('import-snippets-button');
  
  // Add rich text toggle button
  const richTextToggle = document.createElement('button');
  richTextToggle.id = 'rich-text-toggle';
  richTextToggle.textContent = 'Toggle Rich Text';
  richTextToggle.style.marginBottom = '10px';
  snippetValueInput.parentNode.insertBefore(richTextToggle, snippetValueInput.nextSibling);
  
  // Rich text toolbar
  const richTextToolbar = document.createElement('div');
  richTextToolbar.id = 'rich-text-toolbar';
  richTextToolbar.style.display = 'none';
  richTextToolbar.style.marginBottom = '10px';
  richTextToolbar.innerHTML = `
    <button data-command="bold" title="Bold"><b>B</b></button>
    <button data-command="italic" title="Italic"><i>I</i></button>
    <button data-command="underline" title="Underline"><u>U</u></button>
    <button data-command="createLink" title="Insert Link">🔗</button>
    <button data-command="insertHTML" data-value="<hr>" title="Insert Horizontal Line">―</button>
    <button data-command="removeFormat" title="Remove Formatting">Clear</button>
  `;
  snippetValueInput.parentNode.insertBefore(richTextToolbar, snippetValueInput);
  
  // Variable to track if we're in rich text mode
  let isRichTextMode = false;

  // Function to toggle rich text editing mode
  function setRichTextMode(enable) {
    isRichTextMode = enable;
    if (enable) {
      // Convert textarea to contenteditable div
      snippetValueInput.setAttribute('contenteditable', 'true');
      snippetValueInput.style.minHeight = '100px';
      richTextToolbar.style.display = 'block';
      richTextToggle.textContent = 'Switch to Plain Text';
    } else {
      // Convert back to plain textarea
      snippetValueInput.removeAttribute('contenteditable');
      richTextToolbar.style.display = 'none';
      richTextToggle.textContent = 'Switch to Rich Text';
    }
  }
  
  // Toggle rich text mode
  richTextToggle.addEventListener('click', () => {
    if (isRichTextMode) {
      // Convert from rich text to plain text
      const plainText = snippetValueInput.innerText;
      snippetValueInput.value = plainText;
      setRichTextMode(false);
    } else {
      // Convert from plain text to rich text
      const richText = snippetValueInput.value;
      snippetValueInput.innerHTML = richText;
      setRichTextMode(true);
    }
  });
  
  // Handle rich text toolbar buttons
  richTextToolbar.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      const command = button.dataset.command;
      const value = button.dataset.value || null;
      
      if (command === 'createLink') {
        const url = prompt('Enter the URL:', 'http://');
        if (url) document.execCommand(command, false, url);
      } else {
        document.execCommand(command, false, value);
      }
      
      snippetValueInput.focus();
    });
  });

  // Load snippets from storage and display them
  function loadSnippets() {
    chrome.storage.local.get({ snippets: [] }, (result) => {
      const snippets = result.snippets;
      snippetsTableBody.innerHTML = ''; // Clear existing rows
      snippets.forEach((snippet, index) => {
        const row = snippetsTableBody.insertRow();
        const triggerCell = row.insertCell();
        const valueCell = row.insertCell();
        const actionsCell = row.insertCell();

        triggerCell.textContent = snippet.trigger;
        
        // Display rich text content properly
        if (snippet.isRichText) {
          valueCell.innerHTML = snippet.value;
        } else {
          valueCell.textContent = snippet.value;
        }

        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => editSnippet(index));

        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => deleteSnippet(index));

        actionsCell.appendChild(editButton);
        actionsCell.appendChild(deleteButton);
      });
    });
  }

  // Add a new snippet
  addSnippetButton.addEventListener('click', () => {
    const trigger = snippetTriggerInput.value.trim();
    let value;
    
    // Get value based on current mode
    if (isRichTextMode) {
      value = snippetValueInput.innerHTML.trim();
    } else {
      value = snippetValueInput.value.trim();
    }

    if (trigger && value) {
      chrome.storage.local.get({ snippets: [] }, (result) => {
        const snippets = result.snippets;
        // Basic check for hotkey format (e.g., Ctrl+Shift+K)
        // More robust validation can be added
        if (trigger.includes('+') && (trigger.toLowerCase().includes('ctrl') || trigger.toLowerCase().includes('alt') || trigger.toLowerCase().includes('shift') || trigger.toLowerCase().includes('meta'))) {
            // It's a hotkey
            // Validate that it's a supported format
            if (!validateHotkeyFormat(trigger)) {
              alert('Please use a valid hotkey format like Ctrl+Shift+K or Alt+X');
              return;
            }
        } else if (!trigger.startsWith('/')) {
            alert('Text triggers must start with "/". Hotkeys should use combinations like Ctrl+Shift+K.');
            return;
        }

        snippets.push({ 
          trigger, 
          value, 
          isRichText: isRichTextMode 
        });
        
        chrome.storage.local.set({ snippets }, () => {
          snippetTriggerInput.value = '';
          if (isRichTextMode) {
            snippetValueInput.innerHTML = '';
          } else {
            snippetValueInput.value = '';
          }
          loadSnippets();
          // Notify background script about changes if hotkeys are involved
          if (snippets.some(s => s.trigger.includes('+'))) {
            chrome.runtime.sendMessage({ type: 'UPDATE_HOTKEYS', snippets: snippets });
          }
        });
      });
    } else {
      alert('Both trigger and expansion value are required.');
    }
  });
  
  // Validate hotkey format
  function validateHotkeyFormat(hotkey) {
    // Basic validation for hotkey format
    const parts = hotkey.split('+');
    if (parts.length < 2) return false;
    
    // Check for at least one modifier key
    const modifiers = ['ctrl', 'alt', 'shift', 'meta'];
    const hasModifier = parts.some(part => 
      modifiers.includes(part.toLowerCase()));
    
    return hasModifier;
  }


  // Edit a snippet (basic implementation: fill form, user re-adds)
  function editSnippet(index) {
    chrome.storage.local.get({ snippets: [] }, (result) => {
      const snippets = result.snippets;
      const snippet = snippets[index];
      snippetTriggerInput.value = snippet.trigger;
      
      // Handle rich text content when editing
      if (snippet.isRichText) {
        setRichTextMode(true);
        snippetValueInput.innerHTML = snippet.value;
      } else {
        setRichTextMode(false);
        snippetValueInput.value = snippet.value;
      }
      
      // For a better UX, you might want to change the 'Add' button to 'Update'
      // and handle the update logic differently, or use a modal for editing.
      // For simplicity, we'll remove the old one and the user can re-add.
      deleteSnippet(index, false); // Delete without reloading yet
      alert('Snippet loaded into form for editing. Make changes and click "Add Snippet" to save.');
    });
  }

  // Delete a snippet
  function deleteSnippet(index, reload = true) {
    chrome.storage.local.get({ snippets: [] }, (result) => {
      const snippets = result.snippets;
      const deletedSnippet = snippets.splice(index, 1)[0];
      chrome.storage.local.set({ snippets }, () => {
        if (reload) loadSnippets();
        // Notify background script about changes if hotkeys are involved
        if (deletedSnippet && deletedSnippet.trigger.includes('+') || snippets.some(s => s.trigger.includes('+'))) {
            chrome.runtime.sendMessage({ type: 'UPDATE_HOTKEYS', snippets: snippets });
        }
      });
    });
  }

  // Export snippets
  exportSnippetsButton.addEventListener('click', () => {
    chrome.storage.local.get({ snippets: [] }, (result) => {
      const snippets = result.snippets;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snippets, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "quicktext_snippets.json");
      document.body.appendChild(downloadAnchorNode); // required for firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  // Trigger file input for import
  importSnippetsButton.addEventListener('click', () => {
    importSnippetsInput.click();
  });

  // Import snippets
  importSnippetsInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedSnippets = JSON.parse(e.target.result);
          if (Array.isArray(importedSnippets) && importedSnippets.every(s => s.hasOwnProperty('trigger') && s.hasOwnProperty('value'))) {
            // Basic validation, can be improved
            chrome.storage.local.get({ snippets: [] }, (result) => {
                let currentSnippets = result.snippets;
                // Simple merge: add new, overwrite existing with same trigger (could be smarter)
                importedSnippets.forEach(imported => {
                    const existingIndex = currentSnippets.findIndex(s => s.trigger === imported.trigger);
                    if (existingIndex > -1) {
                        currentSnippets[existingIndex] = imported;
                    } else {
                        currentSnippets.push(imported);
                    }
                });
                chrome.storage.local.set({ snippets: currentSnippets }, () => {
                    loadSnippets();
                    alert('Snippets imported successfully!');
                    // Notify background script about changes if hotkeys are involved
                    if (currentSnippets.some(s => s.trigger.includes('+'))) {
                        chrome.runtime.sendMessage({ type: 'UPDATE_HOTKEYS', snippets: currentSnippets });
                    }
                });
            });
          } else {
            alert('Invalid file format. Please import a valid JSON export from QuickText.');
          }
        } catch (error) {
          alert('Error reading or parsing file: ' + error.message);
        }
        // Reset file input to allow importing the same file again if needed
        importSnippetsInput.value = '';
      };
      reader.readAsText(file);
    }
  });

  // Initial load
  loadSnippets();
});