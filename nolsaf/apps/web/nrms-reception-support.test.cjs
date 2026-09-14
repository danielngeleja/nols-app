const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.join(__dirname, 'app/nrms/book/[bookingKey]/page.tsx');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Render the real page with a loaded quote, without network requests or effects.
function renderQuote(quote) {
  let stateIndex = 0;
  const module = { exports: {} };
  const mockReact = {
    ...React,
    use: (params) => params,
    useState: (initial) => React.useState(stateIndex++ === 2 ? quote : initial),
  };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      if (name === 'react') return mockReact;
      if (name === '@/lib/apiClient') return { default: {} };
      if (name.startsWith('@/components/')) return { default: () => null };
      return require(name);
    },
  }, { filename });
  return renderToStaticMarkup(React.createElement(module.exports.default, { params: { bookingKey: 'cktesthotelpublickey12345' } }));
}

const property = { id: 19, title: 'Test hotel' };

for (const contact of [null, undefined]) {
  test(`does not replace missing ${contact} contact settings with a callback-only card`, () => {
    const html = renderQuote({ property, contact, quotes: [] });
    assert.ok(!html.includes('id="reception-contact-title"'));
    assert.ok(!html.includes('Prefer us to contact you?'));
    assert.ok(!html.includes('https://wa.me/'));
    assert.ok(!html.includes('href="tel:'));
    assert.ok(!html.includes('href="mailto:'));
  });
}

test('published contact channels and greeting remain available', () => {
  const html = renderQuote({ property, quotes: [], contact: {
    whatsappPhone: '+255712345678', receptionPhone: '+255712345679',
    receptionEmail: 'reception@example.com', instagramUsername: 'testhotel',
    greeting: 'Welcome to our hotel', contactHours: '06:00 - 23:00',
  } });
  assert.ok(html.includes('Need help choosing a room?'));
  assert.ok(html.includes('Other ways to connect'));
  assert.ok(html.includes('Ask reception to contact you'));
  assert.ok(!html.includes('Let’s find your room.'));
  assert.ok(!html.includes('id="reception-callback"'));
  assert.ok(html.indexOf('id="reception-contact-title"') < html.indexOf('id="guest-details-title"'));
  for (const value of ['https://wa.me/255712345678', 'tel:+255712345679',
    'mailto:reception@example.com', 'https://ig.me/m/testhotel',
    'Welcome to our hotel', '06:00 - 23:00']) assert.ok(html.includes(value), value);
});

test('does not offer reception requests before a property loads', () => {
  assert.ok(!renderQuote(null).includes('id="reception-contact-title"'));
});
