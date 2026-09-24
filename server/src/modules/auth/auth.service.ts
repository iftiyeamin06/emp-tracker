// ponytail: real login (argon2 + sessions) lands with Phase 1 roster work
export async function login(_email: string, _password: string) {
  throw Object.assign(new Error("not_implemented"), { status: 501 });
}
