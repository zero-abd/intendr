import { useEffect, useState } from "react";
import { Avatar, Button, Card, Eyebrow, Field } from "@intendr/ui";
import { useData } from "../hooks/DataProvider";
import { useAuth } from "../auth/AuthProvider";
import { updateProfile } from "../api/profile";

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const { profile, setProfile } = useData();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(profile?.display_name ?? "");
    setAvatar(profile?.avatar_url ?? "");
  }, [profile?.display_name, profile?.avatar_url]);

  const dirty = name !== (profile?.display_name ?? "") || avatar !== (profile?.avatar_url ?? "");

  async function save() {
    if (!user) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const p = await updateProfile(user.id, {
        display_name: name.trim() || null,
        avatar_url: avatar.trim() || null,
      });
      setProfile(p);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page--narrow" style={{ display: "grid", gap: 20 }}>
      <Card glow style={{ animation: "rise 0.5s var(--ease) both" }}>
        <div className="profilehead">
          <Avatar name={name || user?.email} src={avatar || null} size={72} />
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 650, letterSpacing: "-0.02em" }}>
              {name || user?.email?.split("@")[0]}
            </div>
            <div className="mono" style={{ color: "var(--ink-faint)", fontSize: 13, marginTop: 2 }}>
              {user?.email}
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ animation: "rise 0.5s var(--ease) 0.06s both" }}>
        <Eyebrow>Edit profile</Eyebrow>
        <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
          <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <Field
            label="Avatar URL"
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://…/avatar.png"
            hint="Paste an image URL. Leave blank to use your initials."
          />
        </div>
        {err && <div className="auth__alert auth__alert--error" style={{ marginTop: 14 }}>{err}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end", marginTop: 18 }}>
          {saved && <span style={{ color: "var(--good)", fontSize: 13 }}>Saved ✓</span>}
          <Button variant={dirty ? "primary" : "ghost"} disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>

      <Card style={{ animation: "rise 0.5s var(--ease) 0.12s both" }}>
        <div className="rowhead">
          <div>
            <Eyebrow>Session</Eyebrow>
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              Signed in as {user?.email}
            </p>
          </div>
          <Button variant="danger" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
