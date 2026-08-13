// Metro resolves image imports to an asset module id (a number at runtime), which
// React Native accepts directly as an ImageSourcePropType. `.png` is already declared
// by the React Native types; `.jpg`/`.jpeg` are not, so declare them here.
declare module "*.jpg" {
  const asset: number;
  export default asset;
}

declare module "*.jpeg" {
  const asset: number;
  export default asset;
}
