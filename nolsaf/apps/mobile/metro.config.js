const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// This workspace also contains a React 18 web app. Always resolve React from
// the mobile workspace so Metro does not mix that copy with Expo's React 19
// runtime (or mistake the colocated @types/react package for the runtime).
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "react" ||
    moduleName.startsWith("react/") ||
    moduleName === "react-dom" ||
    moduleName.startsWith("react-dom/")
  ) {
    const modulePath = require.resolve(moduleName, { paths: [projectRoot] });
    return context.resolveRequest(context, modulePath, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
