import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const links = [
  ["Home", "/"],
  ["About", "/about"],
  ["Features", "/features"],
  ["How It Works", "/how-it-works"],
  ["Founder", "/founder"],
  ["Contact", "/contact"],
  ["Register College", "/register-college"],
  ["Pricing", "/#pricing"],
];

export function PublicSiteHeader() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = String(user?.role || "").trim().toLowerCase();
  const workspace = {
    super_admin: "/platform",
    college_admin: "/admin",
    admin: "/admin",
    teacher: "/teacher",
    student: "/student",
  }[role];
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="site-brand" aria-label="AttendX home" onClick={closeMenu}>
          <span className="site-brand-mark" aria-hidden="true">A<span>X</span></span>
          <span className="site-brand-copy">AttendX<small>ATTENDANCE, MADE CLEAR</small></span>
        </Link>
        <button
          className="site-menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="public-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <nav id="public-navigation" className={`site-nav ${menuOpen ? "site-nav-open" : ""}`} aria-label="Public navigation">
          {links.map(([label, to]) => (
            to.includes("#")
              ? <a href={to} key={label} onClick={closeMenu}>{label}</a>
              : <Link to={to} key={label} onClick={closeMenu}>{label}</Link>
          ))}
          <Link className="site-nav-login" to={workspace || "/login"} onClick={closeMenu}>
            {workspace ? "My workspace" : "Login"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer-main">
          <div>
            <Link to="/" className="site-brand site-footer-brand" aria-label="AttendX home">
              <span className="site-brand-mark" aria-hidden="true">A<span>X</span></span>
              <span className="site-brand-copy">AttendX<small>ATTENDANCE, MADE CLEAR</small></span>
            </Link>
            <p>AttendX is designed to simplify college attendance management through digital workflows and responsible access.</p>
          </div>
          <nav className="site-footer-nav" aria-label="Explore AttendX">
            <strong>Explore</strong>
            <Link to="/about">About</Link>
            <Link to="/features">Features</Link>
            <Link to="/how-it-works">How It Works</Link>
            <Link to="/founder">Founder</Link>
            <Link to="/#pricing">Pricing status</Link>
          </nav>
          <nav className="site-footer-nav" aria-label="Account and contact">
            <strong>Account</strong>
            <Link to="/login">Login</Link>
            <Link to="/contact">Contact status</Link>
            <Link to="/register-college">Register a College</Link>
          </nav>
          <nav className="site-footer-nav" aria-label="Policies">
            <strong>Policies</strong>
            <Link to="/privacy">Privacy Policy draft</Link>
            <Link to="/terms">Terms draft</Link>
          </nav>
        </div>
        <div className="site-footer-bottom">
          <span>© 2026 AttendX. All rights reserved.</span>
          <span>Founded and Owned by Bablu Kumar Yadav.</span>
        </div>
      </div>
    </footer>
  );
}
