module.exports = function (api) {
  api.cache(true);

  const plugins = ["react-native-reanimated/plugin"];

  // Strip console.log / console.warn / console.error in release builds
  // to prevent internal architecture details and user-adjacent data from
  // leaking into the production JS bundle.  console.warn/error are kept
  // in dev builds for debugging.
  if (process.env.NODE_ENV === "production") {
    plugins.push(["transform-remove-console", { exclude: [] }]);
  }

  return {
    presets: ["babel-preset-expo"],
    plugins
  };
};
