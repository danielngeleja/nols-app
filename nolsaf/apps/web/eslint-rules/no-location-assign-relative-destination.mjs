const absoluteUrl = /^(?:[a-z][\d+.a-z-]*:|\/\/)/i;
const globalObjects = new Set(['window', 'globalThis', 'document', 'self']);

function memberNamed(node, name) {
  return node?.type === 'MemberExpression' &&
    (node.computed
      ? node.property.type === 'Literal' && node.property.value === name
      : node.property.type === 'Identifier' && node.property.name === name);
}

function locationRoot(node) {
  if (node?.type === 'Identifier' && node.name === 'location') return node;
  if (memberNamed(node, 'location') && node.object.type === 'Identifier' &&
      globalObjects.has(node.object.name)) return node.object;
  return null;
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    if (current.set.has(name)) return current.set.get(name);
  }
  return null;
}

function staticPrefix(node, sourceCode, seen = new Set()) {
  if (!node) return null;
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral') return node.quasis[0]?.value.cooked ?? null;
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return staticPrefix(node.left, sourceCode, seen);
  }
  if (node.type !== 'Identifier' || seen.has(node.name)) return null;

  const variable = findVariable(sourceCode.getScope(node), node.name);
  if (!variable || variable.defs.length !== 1 || variable.defs[0].type !== 'Variable') {
    return null;
  }
  const definition = variable.defs[0].node;
  let value = definition.init;
  for (const reference of variable.references) {
    if (reference.identifier.range[0] >= node.range[0]) break;
    if (reference.isWrite() && reference.writeExpr) value = reference.writeExpr;
  }
  return staticPrefix(value, sourceCode, new Set([...seen, node.name]));
}

const noLocationAssignRelativeDestination = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      relativeNavigation: 'Use the Next.js router or redirect() for internal navigation instead of {{expression}}.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    function isGlobal(node) {
      const variable = findVariable(sourceCode.getScope(node), node.name);
      return !variable || variable.defs.length === 0;
    }
    function reportIfRelative(valueNode, root, expression, node) {
      if (!root || !isGlobal(root)) return;
      const value = staticPrefix(valueNode, sourceCode);
      if (value !== null && !absoluteUrl.test(value)) {
        context.report({ node, messageId: 'relativeNavigation', data: { expression } });
      }
    }
    return {
      CallExpression(node) {
        if (!memberNamed(node.callee, 'assign') || !node.arguments[0] ||
            node.arguments[0].type === 'SpreadElement') return;
        reportIfRelative(node.arguments[0], locationRoot(node.callee.object),
          `${sourceCode.getText(node.callee)}()`, node);
      },
      AssignmentExpression(node) {
        if (!memberNamed(node.left, 'href')) return;
        reportIfRelative(node.right, locationRoot(node.left.object),
          sourceCode.getText(node.left), node);
      },
    };
  },
};

export default noLocationAssignRelativeDestination;
