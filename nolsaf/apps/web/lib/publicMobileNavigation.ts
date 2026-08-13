export function hidesPublicMobileNavigation(pathname: string) {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/owner") ||
    pathname.startsWith("/driver") ||
    pathname.startsWith("/agent") ||
    pathname === "/sales" ||
    pathname.startsWith("/sales/") ||
    pathname.startsWith("/menu/") ||
    pathname === "/account/agent" ||
    pathname.startsWith("/account/agent/") ||
    pathname === "/nrms" ||
    pathname.startsWith("/nrms/")
  );
}
