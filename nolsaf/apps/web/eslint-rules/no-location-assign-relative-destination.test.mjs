import { RuleTester } from 'eslint';
import rule from './no-location-assign-relative-destination.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });

tester.run('no-location-assign-relative-destination', rule, {
  valid: [
    "window.location.assign('https://example.com/path')",
    "location.href = '//example.com/path'",
    "function navigate(location) { location.assign('/local'); }",
    "function navigate(window) { window.location.href = '/local'; }",
  ],
  invalid: [
    { code: "location.assign('/local')", errors: [{ messageId: 'relativeNavigation' }] },
    { code: "window.location.href = '/local'", errors: [{ messageId: 'relativeNavigation' }] },
    { code: "globalThis.location['assign'](`/local/${id}`)", errors: [{ messageId: 'relativeNavigation' }] },
    { code: "const target = '/local'; document.location.assign(target)", errors: [{ messageId: 'relativeNavigation' }] },
  ],
});
