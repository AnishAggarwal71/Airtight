// "Use my own key" (BYOK) panel on the start screen.
//
// The key is kept in sessionStorage only: it vanishes when the tab closes and
// is never put in localStorage, a cookie, or any request body. api.js attaches
// it as the X-Anthropic-Key header; the server uses it for that request and
// stores nothing but a "this game is BYOK" flag.

const API_KEY_STORAGE = 'airtight-api-key'

/** The saved key, or '' if none. */
export function getApiKey() {
  return sessionStorage.getItem(API_KEY_STORAGE) || ''
}

function setApiKey(key) {
  sessionStorage.setItem(API_KEY_STORAGE, key)
}

function clearApiKey() {
  sessionStorage.removeItem(API_KEY_STORAGE)
}

/** Wires the panel's Save / Clear buttons and shows whether a key is saved. */
export function initByokPanel() {
  const input = document.getElementById('byok-input')
  const status = document.getElementById('byok-status')
  const saveBtn = document.getElementById('byok-save-btn')
  const clearBtn = document.getElementById('byok-clear-btn')

  function refresh() {
    const has = getApiKey() !== ''
    status.textContent = has
      ? 'Your key is set for this tab. New games will use it instead of the shared budget.'
      : 'No key set. Games use the shared daily budget.'
    clearBtn.classList.toggle('hidden', !has)
    input.value = ''
  }

  saveBtn.addEventListener('click', () => {
    const key = input.value.trim()
    if (key === '') return
    // Shape check only (the server re-checks); catches pasting the wrong thing early.
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
      status.textContent = 'That does not look like an Anthropic key (it starts with "sk-ant-").'
      return
    }
    setApiKey(key)
    refresh()
  })

  clearBtn.addEventListener('click', () => {
    clearApiKey()
    refresh()
  })

  refresh()
}
