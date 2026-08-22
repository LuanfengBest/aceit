"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/inbox", label: "Inbox" },
  { href: "/profile", label: "Material" },
  { href: "/roles", label: "Roles" },
  { href: "/studio", label: "Studio" },
  { href: "/debrief", label: "Debrief" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-bg">
      <div className="mx-auto flex max-w-work items-center gap-6 px-8 py-3">
        <Link href="/" className="font-serif text-section">
          aceit
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-2.5 py-1 text-meta transition-colors ${
                  active
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
