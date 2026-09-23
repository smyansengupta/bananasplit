import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ConfirmEmailForm } from "./confirm-email-form";

/**
 * The link in the verification email. The page itself changes nothing: the
 * token is consumed by the button's POST, so link scanners that prefetch
 * emailed URLs cannot use it up before the person clicks.
 */
export default async function VerifyEmailPage({ params }: PageProps<"/verify-email/[token]">) {
  const { token } = await params;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Verify your email</CardTitle>
          <CardDescription>
            Confirm this address to create or join organizations in CBC Portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmEmailForm token={token} />
        </CardContent>
      </Card>
    </div>
  );
}
