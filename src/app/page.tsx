import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { he } from "@/lib/translations";

const brandLogos = [
  { name: "מינה טומיי", src: "/logos/minna tomei.jpeg" },
  { name: "ויני", src: "/logos/vinni.jpeg" },
  { name: "נתנזון", src: "/logos/natanzon.jpeg" },
  { name: "קינג קונג", src: "/logos/king kong.jpeg" },
];

export default function HomePage() {
  const { home } = he;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-background">
      {/* Header with La Table Logo */}
      <header className="w-full py-8">
        <div className="flex justify-center">
          <Image
            src="/logos/latable.jpeg"
            alt="La Table"
            width={225}
            height={100}
            className="object-contain"
            style={{ width: 'auto', height: 'auto' }}
            priority
          />
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            {home.title}
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            {home.subtitle}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {home.secondarySubtitle}
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Button asChild>
              <Link href="/dashboard">{home.getStarted}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/about">
                {home.learnMore} <span aria-hidden="true">&rarr;</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Footer with Brand Logos */}
      <footer className="w-full py-8 border-t">
        <div className="flex flex-wrap justify-center items-center gap-8 px-6">
          {brandLogos.map((brand) => (
            <Image
              key={brand.name}
              src={brand.src}
              alt={brand.name}
              width={100}
              height={63}
              className="object-contain opacity-70 hover:opacity-100 transition-opacity"
              style={{ width: 'auto', height: 'auto' }}
            />
          ))}
        </div>
      </footer>
    </main>
  );
}
