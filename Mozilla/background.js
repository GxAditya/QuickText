// background.js for Firefox
console.log("QuickText background script started.");

// Function to register hotkeys based on snippets
function registerHotkeys(snippets) {
  // Store hotkey snippets for reference
  const hotkeySnippets = snippets.filter(s => s.trigger.includes('+'));
  console.log("Background: Processing hotkey snippets", hotkeySnippets);
  
  // Store them in local storage for reference
  browser.storage.local.set({ hotkey_snippets: hotkeySnippets });
  
  // In Firefox WebExtensions, we can't dynamically register global hotkeys
  // Instead, we'll use a content script approach to detect key combinations
  // and trigger the appropriate snippet expansion
  
  // Send the hotkey snippets to all active tabs so content scripts can listen for them
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, {
        type: 'UPDATE_HOTKEY_SNIPPETS',
        snippets: hotkeySnippets
      }).catch(error => {
        // Ignore errors for tabs where content script isn't loaded yet
        console.log("Could not update hotkeys for tab: " + tab.id);
      });
    });
  });
}

// Listen for messages from other parts of the extension (e.g., options page)
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'UPDATE_HOTKEYS') {
    console.log("Background: UPDATE_HOTKEYS message received", request.snippets);
    registerHotkeys(request.snippets);
    return Promise.resolve({ success: true, message: "Hotkeys updated in background." });
  }
  return false; // No asynchronous response expected
});

// Listen for extension installation or update
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('QuickText extension installed.');
    // Initialize default snippets or settings if necessary
    browser.storage.local.get({ snippets: [] }).then(result => {
      if (result.snippets.length === 0) {
        // Add some default examples if desired
        // browser.storage.local.set({ snippets: [{trigger: "/hello", value: "Hello there!"}] });
      }
    });
  } else if (details.reason === 'update') {
    console.log('QuickText extension updated to version ' + browser.runtime.getManifest().version);
  }
});

// Listener for commands defined in manifest.json (e.g., opening options page)
browser.commands.onCommand.addListener(async (command) => {
  console.log(`Command received: ${command}`);
  if (command === "_execute_browser_action") { // Firefox uses _execute_browser_action instead of _execute_action
    // This command by default opens the popup if specified in manifest browser_action.default_popup
    // If we wanted to do something else, or ensure options page opens:
    // browser.runtime.openOptionsPage();
  }
  
  // For dynamic user-defined hotkeys, we need to retrieve them from storage
  // and then send a message to the active tab's content script.
  browser.storage.local.get({ snippets: [] }).then(result => {
    const allSnippets = result.snippets;
    const hotkeySnippet = allSnippets.find(s => s.trigger === command && s.trigger.includes('+'));

    if (hotkeySnippet) {
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs[0] && tabs[0].id) {
          browser.tabs.sendMessage(tabs[0].id, {
            type: 'EXPAND_HOTKEY_SNIPPET',
            value: hotkeySnippet.value
          }).then(response => {
            if (response && response.success) {
              console.log("QuickText: Hotkey snippet expanded successfully.");
            } else {
              console.warn("QuickText: Content script could not expand hotkey snippet.", response ? response.message : '');
            }
          }).catch(error => {
            console.warn("QuickText: Error sending hotkey expansion to content script:", error.message);
          });
        }
      });
    }
  });
});

// Initial load of snippets to set up any necessary hotkey logic
browser.storage.local.get({ snippets: [] }).then(result => {
  if (result.snippets && result.snippets.length > 0) {
    registerHotkeys(result.snippets);
  }
});