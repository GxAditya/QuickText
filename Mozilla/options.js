document.addEventListener('DOMContentLoaded', () => {
  const snippetTriggerInput = document.getElementById('snippet-trigger');
  const snippetValueInput = document.getElementById('snippet-value');
  const addSnippetForm = document.getElementById('add-snippet-form');
  const snippetsTableBody = document.querySelector('#snippets-table tbody');
  const exportSnippetsButton = document.getElementById('export-snippets-button');
  const importSnippetsInput = document.getElementById('import-snippets-input');
  const importSnippetsButton = document.getElementById('import-snippets-button');
  
  // Use browser API for Firefox
  const storage = browser.storage;
  const runtime = browser.runtime;
  
  // Add subtle micro-interactions
  addMicroInteractions();
  
  // Function to add micro-interactions
  function addMicroInteractions() {
    // Add ripple effect to buttons
    document.querySelectorAll('.qt-button').forEach(button => {
      button.addEventListener('click', function(e) {
        const ripple = document.createElement('span');
        const rect = this.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        
        ripple.style.cssText = `
          position: absolute;
          width: ${size}px;
          height: ${size}px;
          left: ${x}px;
          top: ${y}px;
          background: rgba(0, 0, 0, 0.1);
          border-radius: 50%;
          transform: scale(0);
          animation: ripple 0.6s ease-out;
          pointer-events: none;
        `;
        
        this.style.position = 'relative';
        this.style.overflow = 'hidden';
        this.appendChild(ripple);
        
        setTimeout(() => ripple.remove(), 600);
      });
    });
    
    // Add focus animations to inputs
    document.querySelectorAll('.qt-input, .qt-textarea').forEach(input => {
      input.addEventListener('focus', function() {
        this.parentElement.style.transform = 'translateY(-2px)';
      });
      
      input.addEventListener('blur', function() {
        this.parentElement.style.transform = 'translateY(0)';
      });
    });
  }
  
  // Add CSS for ripple animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ripple {
      to {
        transform: scale(4);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
  
  // Form submission handler
  addSnippetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addSnippet();
  });
  
  // Load snippets from storage and display them
  function loadSnippets() {
    storage.local.get({ snippets: [] }).then(result => {
      const snippets = result.snippets;
      snippetsTableBody.innerHTML = ''; // Clear existing rows
      snippets.forEach((snippet, index) => {
        const row = snippetsTableBody.insertRow();
        const triggerCell = row.insertCell();
        const valueCell = row.insertCell();
        const actionsCell = row.insertCell();

        triggerCell.textContent = snippet.trigger;
        valueCell.textContent = snippet.value.length > 50 
          ? snippet.value.substring(0, 50) + '...' 
          : snippet.value;

        // Create action buttons
        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.className = 'qt-button qt-button--secondary';
        editButton.addEventListener('click', () => editSnippet(index));

        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.className = 'qt-button qt-button--secondary';
        deleteButton.addEventListener('click', () => deleteSnippet(index));

        actionsCell.className = 'qt-actions';
        actionsCell.appendChild(editButton);
        actionsCell.appendChild(deleteButton);
      });
    });
  }

  // Add a new snippet
  function addSnippet() {
    const trigger = snippetTriggerInput.value.trim();
    const value = snippetValueInput.value.trim();

    if (trigger && value) {
      storage.local.get({ snippets: [] }).then(result => {
        const snippets = result.snippets;
        
        // Validate trigger format
        if (trigger.includes('+') && (trigger.toLowerCase().includes('ctrl') || trigger.toLowerCase().includes('alt') || trigger.toLowerCase().includes('shift') || trigger.toLowerCase().includes('meta'))) {
          // It's a hotkey
          if (!validateHotkeyFormat(trigger)) {
            alert('Please use a valid hotkey format like Ctrl+Shift+K or Alt+X');
            return;
          }
        } else if (!trigger.startsWith('/')) {
          alert('Text triggers must start with "/". Hotkeys should use combinations like Ctrl+Shift+K.');
          return;
        }

        snippets.push({ trigger, value, isRichText: false });
        storage.local.set({ snippets }).then(() => {
          // Clear form
          snippetTriggerInput.value = '';
          snippetValueInput.value = '';
          
          // Reload snippets table
          loadSnippets();
          
          // Update background script with new snippets
          runtime.sendMessage({ type: 'UPDATE_HOTKEYS', snippets });
        });
      });
    } else {
      alert('Please enter both a trigger and expansion text.');
    }
  }

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

  // Edit a snippet
  function editSnippet(index) {
    storage.local.get({ snippets: [] }).then(result => {
      const snippets = result.snippets;
      const snippet = snippets[index];
      snippetTriggerInput.value = snippet.trigger;
      snippetValueInput.value = snippet.value;
      
      // Remove the old snippet
      snippets.splice(index, 1);
      storage.local.set({ snippets });
      
      // Focus on trigger input for editing
      snippetTriggerInput.focus();
    });
  }

  // Delete a snippet
  function deleteSnippet(index) {
    if (confirm('Are you sure you want to delete this snippet?')) {
      storage.local.get({ snippets: [] }).then(result => {
        const snippets = result.snippets;
        snippets.splice(index, 1);
        storage.local.set({ snippets }).then(() => {
          loadSnippets();
          runtime.sendMessage({ type: 'UPDATE_HOTKEYS', snippets });
        });
      });
    }
  }

  // Export snippets
  exportSnippetsButton.addEventListener('click', () => {
    storage.local.get({ snippets: [] }).then(result => {
      const dataStr = JSON.stringify(result.snippets, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      
      const exportFileDefaultName = 'quicktext-snippets.json';
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    });
  });

  // Import snippets
  importSnippetsButton.addEventListener('click', () => {
    importSnippetsInput.click();
  });

  importSnippetsInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importedSnippets = JSON.parse(event.target.result);
          storage.local.get({ snippets: [] }).then(result => {
            const existingSnippets = result.snippets;
            const mergedSnippets = [...existingSnippets, ...importedSnippets];
            storage.local.set({ snippets: mergedSnippets }).then(() => {
              loadSnippets();
              runtime.sendMessage({ type: 'UPDATE_HOTKEYS', snippets: mergedSnippets });
              alert('Snippets imported successfully!');
            });
          });
        } catch (error) {
          alert('Error importing snippets. Please ensure the file is a valid JSON file.');
        }
      };
      reader.readAsText(file);
    }
  });

  // Initial load
  loadSnippets();
});