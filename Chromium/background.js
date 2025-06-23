// background.js
console.log("QuickText background service worker started.");

// Function to register hotkeys based on snippets
function registerHotkeys(snippets) {
  // Store hotkey snippets for reference
  const hotkeySnippets = snippets.filter(s => s.trigger.includes('+'));
  console.log("Background: Processing hotkey snippets", hotkeySnippets);
  
  // Store them in local storage for reference
  chrome.storage.local.set({ hotkey_snippets: hotkeySnippets });
  
  // In Manifest V3, we can't dynamically register global hotkeys
  // Instead, we'll use a content script approach to detect key combinations
  // and trigger the appropriate snippet expansion
  
  // Send the hotkey snippets to all active tabs so content scripts can listen for them
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'UPDATE_HOTKEYS') {
    console.log("Background: UPDATE_HOTKEYS message received", request.snippets);
    registerHotkeys(request.snippets);
    sendResponse({ success: true, message: "Hotkeys updated in background." });
  }
  return true; // Keep message channel open for asynchronous response if needed
});

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('QuickText extension installed.');
    // Initialize default snippets or settings if necessary
    chrome.storage.local.get({ snippets: [] }, (result) => {
      if (result.snippets.length === 0) {
        // Add some default examples if desired
        // chrome.storage.local.set({ snippets: [{trigger: "/hello", value: "Hello there!"}] });
      }
    });
  } else if (details.reason === 'update') {
    console.log('QuickText extension updated to version ' + chrome.runtime.getManifest().version);
  }
});

// Listener for commands defined in manifest.json (e.g., opening options page)
chrome.commands.onCommand.addListener(async (command) => {
  console.log(`Command received: ${command}`);
  if (command === "_execute_action") { // This is the command to open the popup (options.html)
    // This command by default opens the popup if specified in manifest action.default_popup
    // If we wanted to do something else, or ensure options page opens:
    // chrome.runtime.openOptionsPage();
  }
  // Handle other custom commands if we define them for specific snippets
  // This is where we would map manifest-defined hotkeys to specific snippet expansions.
  // For dynamic user-defined hotkeys, this is not the direct mechanism.

  // Example: If we had a command like "expand_email_signature"
  // if (command === "expand_email_signature") { ... }

  // For dynamic user-defined hotkeys, we need to retrieve them from storage
  // and then send a message to the active tab's content script.
  chrome.storage.local.get({ snippets: [] }, (result) => {
    const allSnippets = result.snippets;
    const hotkeySnippet = allSnippets.find(s => s.trigger === command && s.trigger.includes('+'));

    if (hotkeySnippet) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'EXPAND_HOTKEY_SNIPPET',
            value: hotkeySnippet.value
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn("QuickText: Error sending hotkey expansion to content script:", chrome.runtime.lastError.message);
            } else if (response && response.success) {
              console.log("QuickText: Hotkey snippet expanded successfully.");
            } else {
              console.warn("QuickText: Content script could not expand hotkey snippet.", response ? response.message : '');
            }
          });
        }
      });
    }
  });
});

// Initial load of snippets to set up any necessary hotkey logic
// This part is tricky because `chrome.commands.update` is not for adding new commands dynamically,
// only for updating shortcuts of existing commands.
// So, user-defined hotkeys need to be handled differently.
// One way: content scripts listen for key combinations.
// Another way: if we limit hotkeys to a few (e.g., 4-5), we can pre-define them in manifest
// and let users assign snippets to them.

// For now, the `onCommand` listener above will try to match the command string
// with a snippet trigger that looks like a hotkey. This implies that for a user-defined
// hotkey to work via `chrome.commands`, it must *also* be defined in the `commands` section
// of `manifest.json`. This is a limitation.

// A more robust dynamic hotkey system would involve content scripts listening for key events
// and checking against the stored hotkey_snippets, then requesting expansion from background
// or performing it directly if it has the snippet value.

console.log("QuickText background.js fully initialized.");

// To make user-defined hotkeys work more globally without defining them all in manifest:
// The `options.js` should inform the background script of all snippets.
// The background script stores them.
// The `chrome.commands.onCommand` will be used for a *generic* command, e.g., "trigger_quicktext_lookup".
// When this generic command is fired, the background script would then need to know what keys were *actually* pressed
// to cause it, which `chrome.commands.onCommand` doesn't provide directly.
// This is a fundamental challenge with fully dynamic global hotkeys in Chrome extensions.

// The current `options.js` saves hotkeys like "Ctrl+Shift+K".
// The `manifest.json` has `_execute_action` for `Ctrl+Shift+E` (opens options).
// If users define a snippet with trigger "Ctrl+Shift+S", it won't automatically become a global hotkey
// unless we add "Ctrl+Shift+S" to manifest.json's commands and map it.

// The current `onCommand` listener will attempt to match the `command` string (e.g., "my_custom_command_name")
// with a snippet trigger. So, if manifest has:
// "commands": { "my_custom_command_name": { "suggested_key": "Ctrl+Shift+S", "description": "..." } }
// And user creates a snippet with trigger "my_custom_command_name", it would work.
// But if user types "Ctrl+Shift+S" as trigger, it won't directly map unless `command` name is "Ctrl+Shift+S".

// Let's simplify: The `options.js` should ensure that if a user enters a hotkey trigger,
// it's one of the pre-defined (or a limited set of configurable) commands in the manifest.
// For now, we only have `_execute_action`. We might need to add a few generic commands like `custom_hotkey_1`.
// The current `background.js` will try to match `command` from `onCommand` with `snippet.trigger`.
// This means if a command in manifest is named `my_snippet_command`, and a snippet trigger is `my_snippet_command`,
// and the hotkey for `my_snippet_command` is pressed, it will expand.