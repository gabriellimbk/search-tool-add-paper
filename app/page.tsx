import { redirect } from "next/navigation";
import ConverterClient from "@/components/converter-client";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function buildCurrentPath(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) {
          query.append(key, item);
        }
      }
      continue;
    }

    if (value) {
      query.set(key, value);
    }
  }

  const serialized = query.toString();
  return serialized ? `/?${serialized}` : "/";
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(buildCurrentPath(params))}`);
  }

  const email = user.email?.toLowerCase() ?? "";
  if (!email.endsWith("@ri.edu.sg")) {
    await supabase.auth.signOut();
    redirect(`/login?next=${encodeURIComponent(buildCurrentPath(params))}&error=${encodeURIComponent("Use an @ri.edu.sg email address.")}`);
  }

  return <ConverterClient userEmail={user.email ?? "Signed in"} />;
}
