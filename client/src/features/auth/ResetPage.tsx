import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { z } from "zod";
import { api, errorMessage } from "@/api/client";
import { Wordmark } from "@/app/layout/Wordmark";
import { TextField } from "@/components/common/Fields";
import { Button } from "@/components/ui/button";

const requestSchema = z.object({ email: z.string().trim().email("Enter a valid email address.") });
const completeSchema = z.object({
  password: z.string().min(10, "Use at least 10 characters.").regex(/[A-Za-z]/, "Include a letter.").regex(/[0-9]/, "Include a number."),
  confirm: z.string(),
}).refine(v => v.password === v.confirm, { path: ["confirm"], message: "The passwords do not match." });

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center"><Wordmark className="text-3xl" /><h1 className="mt-4 text-xl">{title}</h1></div>
        <div className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">{children}</div>
        <p className="mt-3 text-center text-sm"><Link href="/" className="inline-flex min-h-11 items-center px-2 text-primary underline-offset-4 hover:underline">Back to sign in</Link></p>
      </div>
    </div>
  );
}

function RequestForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ resolver: zodResolver(requestSchema) });
  const onSubmit = handleSubmit(async v => {
    setError(null);
    try { await api.post("/api/auth/reset/request", v); setSent(true); } catch (e) { setError(errorMessage(e)); }
  });
  if (sent) return <p>If that email has an account, a reset link has been sent. Ask your clinic administrator if it does not arrive, as they can set a new password for you.</p>;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-muted-foreground">Enter your email and we will send a reset link.</p>
      <TextField label="Email" type="email" inputMode="email" autoComplete="username" autoFocus error={errors.email?.message} {...register("email")} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />}Send reset link</Button>
    </form>
  );
}

function CompleteForm({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof completeSchema>>({ resolver: zodResolver(completeSchema) });
  const onSubmit = handleSubmit(async v => {
    setError(null);
    try { await api.post("/api/auth/reset/complete", { token, password: v.password }); toast.success("Password changed. Sign in with the new password."); navigate("/"); }
    catch (e) { setError(errorMessage(e)); }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField label="New password" type="password" autoComplete="new-password" hint="At least 10 characters, with a letter and a number." autoFocus error={errors.password?.message} {...register("password")} />
      <TextField label="Repeat the password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register("confirm")} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />}Set new password</Button>
    </form>
  );
}

export default function ResetPage() {
  const token = new URLSearchParams(useSearch()).get("token");
  return <Shell title={token ? "Choose a new password" : "Reset your password"}>{token ? <CompleteForm token={token} /> : <RequestForm />}</Shell>;
}
