import React from "react";

export function Link({ to, children, onClick, ...props }) {
  return React.createElement("a", {
    href: to,
    ...props,
    onClick(event) {
      onClick?.(event);
      event.preventDefault();
    },
  }, children);
}

export function MemoryRouter({ children }) {
  return React.createElement(React.Fragment, null, children);
}

export function useNavigate() {
  return (...args) => globalThis.__routerNavigationMock?.(...args);
}
