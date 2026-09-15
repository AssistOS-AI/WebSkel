// Main WebSkel class
export { default as WebSkel } from './webSkel.js';

// Secure browser identifiers, including plain-HTTP LAN origins.
export { createSecureUuid } from './utils/uuid.mjs';

// Utility functions from dom-utils.js
export {
    moveCursorToEnd,
    getClosestParentElement,
    reverseQuerySelector,
    notBasePage,
    unsanitize,
    sanitize,
    normalizeSpaces,
    customTrim,
    getMainAppContainer,
    getClosestParentWithPresenter,
    invalidateParentElement,
    refreshElement
} from './utils/dom-utils.js';

// Utility functions from modal-utils.js
export {
    showModal,
    closeModal,
    removeActionBox,
    showActionBox
} from './utils/modal-utils.js';

// Utility functions from form-utils.js
export {
    extractFormInformation,
    imageUpload
} from './utils/form-utils.js';

// Utility functions from template-utils.js
export {
    createTemplateArray,
    findDoubleDollarWords
} from './utils/template-utils.js';

// Utility functions from browser-utils.js
export {
    getBrowser,
    getURLParams,
    getHashParams
} from './utils/browser-utils.js';

// ResourceManager class
export { ResourceManager } from './managers/ResourceManager.js';

// Re-export everything as a default export for backward compatibility
export { default } from './webSkel.js';
