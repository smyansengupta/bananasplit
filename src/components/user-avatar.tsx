import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarSource, initialsOf } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * A member's picture everywhere a person appears (task assignees, the org
 * chart, database rows, the roster, the shell): the uploaded avatar
 * (responsive WebP variants with srcSet), then the OAuth image, then
 * initials. Works in server and client components.
 *
 *   <UserAvatar user={member} size="sm" />
 *
 * `user` is the userPublicSelect shape (id, name, image, avatar); an email
 * may be passed for the initials fallback where the viewer may see it.
 */

const SIZES = {
  xs: { px: 20, className: "size-5 text-[10px]" },
  sm: { px: 24, className: "size-6 text-xs" },
  md: { px: 32, className: "size-8 text-sm" },
  lg: { px: 40, className: "size-10 text-sm" },
  xl: { px: 64, className: "size-16 text-lg" },
} as const;

export type UserAvatarSize = keyof typeof SIZES;

export interface UserAvatarUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  avatar?: unknown;
}

export function UserAvatar({
  user,
  size = "md",
  className,
  decorative = true,
}: {
  user: UserAvatarUser;
  size?: UserAvatarSize;
  className?: string;
  /** When false, the image is announced with the person's name. */
  decorative?: boolean;
}) {
  const { px, className: sizeClass } = SIZES[size];
  const source = avatarSource(user, px);
  const label = user.name ?? user.email ?? "Member";
  return (
    <Avatar
      className={cn(sizeClass, className)}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : label}
    >
      {source && (
        <AvatarImage
          src={source.src}
          srcSet={source.srcSet}
          alt={decorative ? "" : label}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="text-[length:inherit]">{initialsOf(user.name, user.email)}</AvatarFallback>
    </Avatar>
  );
}
