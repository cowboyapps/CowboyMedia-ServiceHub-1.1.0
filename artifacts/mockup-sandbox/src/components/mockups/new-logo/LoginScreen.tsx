import "../_group.css";

export function LoginScreen() {
  return (
    <div className="dark min-h-screen w-full font-sans antialiased">
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center">
            <img
              src="/__mockup/images/new-logo.png"
              alt="CowboyMedia ServiceHub"
              className="mx-auto mb-4 h-36 w-auto object-contain"
            />
            <p className="text-sm text-muted-foreground">
              Monitor services, get alerts, submit tickets
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-sm">
            <div className="p-6">
              <div className="mb-6 grid grid-cols-2 rounded-lg bg-secondary p-1 text-sm font-medium">
                <span className="rounded-md bg-background py-1.5 text-center shadow-sm">Sign In</span>
                <span className="py-1.5 text-center text-muted-foreground">Sign Up</span>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Username</label>
                  <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
                    Enter your username
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Password</label>
                  <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
                    ••••••••
                  </div>
                </div>
                <div className="flex h-10 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                  Sign In
                </div>
                <p className="text-center text-sm text-muted-foreground">Forgot your password?</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
