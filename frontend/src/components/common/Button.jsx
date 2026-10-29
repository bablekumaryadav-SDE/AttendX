export default function Button({
  children,
  type = "button",
  loading = false,
  disabled = false,
  className = "",
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`app-button ${className}`}
      {...props}
    >
      {loading ? "Signing in..." : children}
    </button>
  );
}