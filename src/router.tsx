import { useCallback } from "react";
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  useNavigate as useRouterNavigate,
  type LinkProps,
  type NavigateOptions,
  type NavLinkProps,
  type To,
} from "react-router";

// Elke navigatie in de app gebruikt een vloeiende overgang (View Transitions, zie STIJLBOEK.md → Beweging).
// Gebruik daarom altijd deze Link, NavLink en useNavigate, niet die van react-router zelf.

export function Link(props: LinkProps) {
  return <RouterLink viewTransition {...props} />;
}

export function NavLink(props: NavLinkProps) {
  return <RouterNavLink viewTransition {...props} />;
}

export function useNavigate() {
  const navigate = useRouterNavigate();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => (typeof to === "number" ? navigate(to) : navigate(to, { viewTransition: true, ...options })),
    [navigate],
  );
}
