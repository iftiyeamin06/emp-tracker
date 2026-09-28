import { post } from "../api/client";
import type { SessionUser } from "../features/auth/LoginPage";

export default function TopBar({ me, onLogout }: { me: SessionUser; onLogout: () => void }) {
  const logout = async () => {
    try {
      await post("/api/auth/logout");
    } finally {
      onLogout();
    }
  };

  return (
    <header>
      <span>
        {me.email} ({me.role})
      </span>{" "}
      <button onClick={logout}>Log out</button>
    </header>
  );
}
