import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Outreach CRM</CardTitle>
          <CardDescription>Enter the team password to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/api/login" className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoFocus
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">Wrong password.</p>
            )}
            <Button type="submit">Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
