export function isPasswordPolicyValid(password) {
  return typeof password === "string"
    && password.length >= 12
    && new TextEncoder().encode(password).length <= 72
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}
