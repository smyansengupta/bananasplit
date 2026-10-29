"use client";

import { type FormEvent, useState, useTransition } from "react";

import { inviteMember } from "@/app/app/[orgSlug]/settings/members/actions";
import { brandInputClass } from "@/components/brand/fields";
import { pill } from "@/components/brand/pill";
import {
  continueLinkClass,
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { Role } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { useGoNext } from "./step-flow";
import { FieldSelect } from "@/components/ui/field-select";

type InviteRole = typeof Role.ADMIN | typeof Role.TREASURER | typeof Role.MEMBER;

const ROLES: { value: InviteRole; label: string }[] = [
  { value: Role.ADMIN, label: "Admin" },
  { value: Role.TREASURER, label: "Treasurer" },
  { value: Role.MEMBER, label: "Member" },
];

const roleLabel = (role: string) =>
  ROLES.find((r) => r.value === role)?.label ?? role.charAt(0) + role.slice(1).toLowerCase();

/**
 * Invite members: the invite code and link (anyone with it joins as a
 * member), and email invites (the same as Settings > Members, valid for 7
 * days). The box takes a whole list, pasted from a spreadsheet or another
 * app's member export, so a team moves over in one go.
 */
export function InviteStep({
  orgId,
  orgSlug,
  backHref,
  code,
  joinUrl,
  invites,
}: {
  orgId: string;
  orgSlug: string;
  backHref: string | null;
  /** The club's code, when it's turned on. */
  code: string | null;
  joinUrl: string;
  invites: { email: string; role: string }[];
}) {
  const { preview, goNext } = useGoNext("org", orgSlug, "invite");
  const [sent, setSent] = useState(invites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>(Role.MEMBER);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [inviting, startInvite] = useTransition();
  const [finishing, startFinish] = useTransition();

  function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // A list works too: commas, spaces, semicolons or new lines between them.
    const emails = [
      ...new Set(
        email
          .toLowerCase()
          .split(/[\s,;]+/)
          .filter(Boolean),
      ),
    ];
    startInvite(async () => {
      const done: { email: string; role: string }[] = [];
      const failed: string[] = [];
      let firstError: string | null = null;
      for (const address of emails) {
        const result = preview ? null : await inviteMember(orgId, { email: address, role });
        if (result?.error) {
          failed.push(address);
          firstError ??= `${address}: ${result.error}`;
        } else done.push({ email: address, role });
      }
      setSent([...done, ...sent]);
      setEmail(failed.join(", "));
      if (firstError) setError(firstError);
    });
  }

  async function copy(what: "code" | "link") {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(what === "code" ? code : `${joinUrl}?code=${code}`);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Couldn't copy. Select the code and copy it instead.");
    }
  }

  const finish = () => startFinish(goNext);

  return (
    <SetupCard>
      <StepIntro title="Bring your people in.">
        Share the link, or paste everyone&apos;s email.
      </StepIntro>

      <StepBody className="gap-5">
        {code && (
          <div className="bg-muted/70 flex flex-col items-center gap-4 rounded-[20px] px-4 py-6">
            <span
              className="flex items-center gap-1.5"
              aria-label={`Invite code ${code.split("").join(" ")}`}
            >
              {code.split("").map((ch, i) => (
                <span key={i} className="contents">
                  {i === 4 && <span className="text-muted-foreground px-0.5 text-[22px]">–</span>}
                  <span
                    aria-hidden="true"
                    className="bg-card grid h-12 w-9 place-items-center rounded-[10px] font-mono text-[22px] font-bold shadow-[var(--elevation-1)] sm:w-10"
                  >
                    {ch}
                  </span>
                </span>
              ))}
            </span>
            <span className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => copy("link")} className={continueLinkClass}>
                {copied === "link" ? "Link copied" : "Copy invite link"}
              </button>
              <button
                type="button"
                onClick={() => copy("code")}
                className={pill({ tone: "outline", size: "md" })}
              >
                {copied === "code" ? "Copied" : "Copy code"}
              </button>
            </span>
          </div>
        )}

        <form onSubmit={invite} className="flex flex-col gap-2">
          <label htmlFor="invite-email" className="sr-only">
            Invite by email
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="invite-email"
              type="text"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Emails"
              autoComplete="off"
              className={cn(brandInputClass, "min-w-0 flex-[1_1_220px]")}
            />
            <FieldSelect
              aria-label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value as InviteRole)}
              className={cn(brandInputClass, "w-auto flex-none cursor-pointer pr-3")}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </FieldSelect>
            <button
              type="submit"
              disabled={inviting || !email.trim()}
              className={cn(pill({ size: "field" }), "flex-none")}
            >
              {inviting ? "Sending…" : "Send invites"}
            </button>
          </div>
          <span className="text-muted-foreground text-[13px]">
            Paste one address or a whole list. Each link is valid for 7 days.
          </span>
        </form>

        {sent.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Invites sent">
            {sent.map((invite) => (
              <li
                key={invite.email}
                className="bg-card border-foreground/10 rounded-field flex h-10 items-center gap-3 border px-4"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                  {invite.email}
                </span>
                <span className="text-muted-foreground text-[13px]">{roleLabel(invite.role)}</span>
                <span className="bg-tint-success text-tint-success-foreground rounded-full px-2 py-0.5 text-[11px] font-bold">
                  ✓ Invited
                </span>
              </li>
            ))}
          </ul>
        )}
      </StepBody>

      <StepError message={error} />
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={
          sent.length === 0
            ? { onClick: finish, disabled: finishing, label: "Skip for now" }
            : undefined
        }
      >
        <ContinuePill pending={finishing} pendingLabel="One moment…" onClick={finish}>
          Continue
        </ContinuePill>
      </StepFooter>
    </SetupCard>
  );
}
