// options.js for Firefox
document.addEventListener('DOMContentLoaded', function() {
  // Load existing snippets
  loadSnippets();
  
  // Set up event listeners
  document.getElementById('add-snippet-form').addEventListener('submit', addSnippet);
  document.getElementById('import-button').addEventListener('click', importSnippets);
  document.getElementById('export-button').addEventListener('click', exportSnippets);
});

// Function to sanitize HTML content to prevent XSS attacks
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString('<div></div>', 'text/html');
  const container = doc.body.firstChild;
  
  // Set the potentially unsafe HTML
  container.innerHTML = html;
  
  // Remove potentially dangerous elements and attributes
  const scripts = container.querySelectorAll('script, iframe, object, embed, form');
  scripts.forEach(node => node.remove());
  
  // Remove dangerous attributes (event handlers, javascript: URLs)
  const allElements = container.querySelectorAll('*');
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
  
  return container.innerHTML;
}

// Load snippets from storage and display them
function loadSnippets() {
  browser.storage.local.get({ snippets: [] }).then(result => {
    const snippets = result.snippets;
    const snippetTable = document.getElementById('snippet-table');
    const snippetBody = document.getElementById('snippet-body');
    
    // Clear existing rows
    snippetBody.innerHTML = ''; // Safe usage - empty string
    
    // Add each snippet to the table
    snippets.forEach((snippet, index) => {
      const row = document.createElement('tr');
      
      // Trigger column
      const triggerCell = document.createElement('td');
      triggerCell.textContent = snippet.trigger;
      row.appendChild(triggerCell);
      
      // Value column (preview)
      const valueCell = document.createElement('td');
      valueCell.textContent = snippet.value.length > 50 ? 
        snippet.value.substring(0, 50) + '...' : snippet.value;
      row.appendChild(valueCell);
      
      // Actions column
      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions';
      
      // Edit button
      const editButton = document.createElement('button');
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => editSnippet(index));
      actionsCell.appendChild(editButton);
      
      // Delete button
      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteSnippet(index));
      actionsCell.appendChild(deleteButton);
      
      row.appendChild(actionsCell);
      snippetBody.appendChild(row);
    });
    
    // Update hotkeys in background script
    browser.runtime.sendMessage({
      type: 'UPDATE_HOTKEYS',
      snippets: snippets
    }).then(response => {
      console.log('Hotkeys updated:', response);
    }).catch(error => {
      console.error('Error updating hotkeys:', error);
    });
  });
}

// Add a new snippet
function addSnippet(event) {
  event.preventDefault();
  
  const triggerInput = document.getElementById('trigger-input');
  const valueInput = document.getElementById('value-input');
  
  const trigger = triggerInput.value.trim();
  const value = valueInput.value.trim();
  
  if (!trigger || !value) {
    alert('Both trigger and value are required!');
    return;
  }
  
  // Get existing snippets, add the new one, and save
  browser.storage.local.get({ snippets: [] }).then(result => {
    const snippets = result.snippets;
    
    // Check for duplicate triggers
    const duplicateIndex = snippets.findIndex(s => s.trigger === trigger);
    if (duplicateIndex !== -1) {
      if (confirm(`A snippet with trigger "${trigger}" already exists. Do you want to replace it?`)) {
        snippets[duplicateIndex].value = value;
      } else {
        return;
      }
    } else {
      snippets.push({ trigger, value });
    }
    
    // Save updated snippets
    browser.storage.local.set({ snippets }).then(() => {
      // Clear form and reload snippets
      triggerInput.value = '';
      valueInput.value = '';
      loadSnippets();
    });
  });
}

// Edit an existing snippet
function editSnippet(index) {
  browser.storage.local.get({ snippets: [] }).then(result => {
    const snippets = result.snippets;
    const snippet = snippets[index];
    
    if (snippet) {
      // Populate form with snippet data
      document.getElementById('trigger-input').value = snippet.trigger;
      document.getElementById('value-input').value = snippet.value;
      
      // Remove the snippet from the list (will be re-added on save)
      snippets.splice(index, 1);
      browser.storage.local.set({ snippets }).then(() => {
        loadSnippets();
      });
    }
  });
}

// Delete a snippet
function deleteSnippet(index) {
  if (confirm('Are you sure you want to delete this snippet?')) {
    browser.storage.local.get({ snippets: [] }).then(result => {
      const snippets = result.snippets;
      
      // Remove the snippet at the specified index
      snippets.splice(index, 1);
      
      // Save updated snippets
      browser.storage.local.set({ snippets }).then(() => {
        loadSnippets();
      });
    });
  }
}

// Export snippets as JSON
function exportSnippets() {
  browser.storage.local.get({ snippets: [] }).then(result => {
    const snippets = result.snippets;
    const dataStr = JSON.stringify(snippets, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'quicktext-snippets.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  });
}

// Import snippets from JSON
function importSnippets() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  
  fileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const snippets = JSON.parse(e.target.result);
        
        if (!Array.isArray(snippets)) {
          throw new Error('Invalid format: Expected an array of snippets');
        }
        
        // Validate each snippet
        snippets.forEach(snippet => {
          if (!snippet.trigger || !snippet.value) {
            throw new Error('Invalid snippet format: Each snippet must have a trigger and value');
          }
        });
        
        // Confirm import
        if (confirm(`Import ${snippets.length} snippets? This will replace any duplicates.`)) {
          // Merge with existing snippets, replacing duplicates
          browser.storage.local.get({ snippets: [] }).then(result => {
            let existingSnippets = result.snippets;
            
            // Remove any existing snippets with the same triggers
            const existingTriggers = new Set(snippets.map(s => s.trigger));
            existingSnippets = existingSnippets.filter(s => !existingTriggers.has(s.trigger));
            
            // Combine existing and imported snippets
            const combinedSnippets = [...existingSnippets, ...snippets];
            
            // Save combined snippets
            browser.storage.local.set({ snippets: combinedSnippets }).then(() => {
              loadSnippets();
              alert('Snippets imported successfully!');
            });
          });
        }
      } catch (error) {
        alert('Error importing snippets: ' + error.message);
      }
    };
    reader.readAsText(file);
  });
  
  fileInput.click();
}