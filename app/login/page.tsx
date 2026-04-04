import LoginForm from "@/components/login-form";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorParam = params.error;
  const nextParam = params.next;

  const initialError =
    typeof errorParam === "string" ? errorParam : Array.isArray(errorParam) ? errorParam[0] ?? null : null;
  const nextPath =
    typeof nextParam === "string" ? nextParam : Array.isArray(nextParam) ? nextParam[0] ?? "/" : "/";

  return <LoginForm initialError={initialError} nextPath={nextPath} />;
}
