import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { DEMO_PASSWORD } from "@shared/demo";
import { api } from "@/api/client";
import { errorMessage } from "@/api/client";
import { Wordmark } from "@/app/layout/Wordmark";
import { TextField } from "@/components/common/Fields";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type Values = z.infer<typeof schema>;

type DemoInfo = { enabled: boolean; accounts: Array<{ email: string; name: string; title: string }> };

/** Only shown on a public showcase (DEMO_MODE): one click signs in as a team member. */
function DemoAccounts({ onPick, busy }: { onPick: (email: string) => void; busy: string | null }) {
  const demo = useQuery({ queryKey: ["demo-accounts"], queryFn: () => api.get<DemoInfo>("/api/auth/demo"), staleTime: Infinity });
  if (!demo.data?.enabled) return null;
  return (
    <section aria-label="Demo accounts" className="mb-4 rounded-xl border border-border bg-card p-5 md:p-6">
      <h2 className="text-lg">Sign in as</h2>
      <p className="mb-3 text-sm text-muted-foreground">Pick a team member to look around.</p>
      <ul className="space-y-2">
        {demo.data.accounts.map(a => (
          <li key={a.email}>
            <Button variant="secondary" className="h-auto min-h-11 w-full justify-between py-2 text-left" disabled={!!busy} onClick={() => onPick(a.email)}>
              <span><span className="block font-medium">{a.name}</span><span className="block text-sm font-normal text-muted-foreground">{a.title}</span></span>
              {busy === a.email && <Loader2 className="animate-spin" />}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pickDemo = async (email: string) => {
    setError(null); setBusy(email);
    try { await signIn(email, DEMO_PASSWORD); } catch (e) { setError(errorMessage(e, "Could not sign in. Try again.")); setBusy(null); }
  };
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async v => {
    setError(null);
    try { await signIn(v.email, v.password); }
    catch (e) { setError(errorMessage(e, "Could not sign in. Try again.")); }
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Wordmark className="text-4xl" />
          <p className="mt-3 text-muted-foreground">Sign in to your clinic account.</p>
        </div>
        <DemoAccounts onPick={email => void pickDemo(email)} busy={busy} />
        {busy && error && <p role="alert" className="mb-4 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">
          <TextField label="Email" type="email" autoComplete="username" inputMode="email" autoFocus error={errors.email?.message} {...register("email")} />
          <TextField label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register("password")} />
          {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />}Sign in</Button>
          <p className="text-center text-sm"><Link href="/reset" className="inline-flex min-h-11 items-center px-2 text-primary underline-offset-4 hover:underline">Forgot your password?</Link></p>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">Vetflow by Astraon Labs</p>
      </div>
    </div>
  );
}
