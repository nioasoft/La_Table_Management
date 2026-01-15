import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileSpreadsheet,
  Users,
  Calculator,
  Mail,
  CheckCircle,
  ArrowRight
} from "lucide-react";

const features = [
  {
    icon: FileSpreadsheet,
    title: "ניהול קבצים אוטומטי",
    description: "קליטת קבצי מבנה אחיד (BKMVDATA) עם פרסור והתאמה אוטומטית לספקים",
  },
  {
    icon: Users,
    title: "ניהול ספקים וזכיינים",
    description: "מעקב אחר כל הספקים והזכיינים, כולל כינויים והיסטוריית עמלות",
  },
  {
    icon: Calculator,
    title: "חישוב עמלות",
    description: "חישוב אוטומטי של עמלות לפי אחוז או סכום קבוע לפריט",
  },
  {
    icon: Mail,
    title: "תקשורת אוטומטית",
    description: "שליחת בקשות קבצים ותזכורות בצורה אוטומטית לספקים וזכיינים",
  },
  {
    icon: CheckCircle,
    title: "התאמות ואישורים",
    description: "זיהוי פערים בין דיווחי ספקים לזכיינים ותהליך אישור מסודר",
  },
];

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="w-full py-6 border-b">
        <div className="container mx-auto flex items-center justify-between px-6">
          <Link href="/">
            <Image
              src="/logos/latable.jpeg"
              alt="La Table"
              width={150}
              height={67}
              className="object-contain"
            />
          </Link>
          <Button asChild>
            <Link href="/sign-in">כניסה למערכת</Link>
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 px-6">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            מערכת ניהול עמלות La Table
          </h1>
          <p className="mt-6 text-xl text-muted-foreground max-w-2xl mx-auto">
            פלטפורמה מתקדמת לניהול עמלות, התאמות ותקשורת עם ספקים וזכיינים
            עבור קבוצת המסעדות La Table
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 px-6 bg-muted/30">
        <div className="container mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10">יכולות המערכת</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="bg-background">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-primary/10 p-3">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{feature.title}</h3>
                      <p className="text-muted-foreground mt-1">{feature.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Brands Section */}
      <section className="py-12 px-6">
        <div className="container mx-auto text-center">
          <h2 className="text-2xl font-bold mb-8">המותגים שלנו</h2>
          <div className="flex flex-wrap justify-center items-center gap-12">
            {[
              { name: "מינה טומיי", src: "/logos/minna tomei.jpeg" },
              { name: "ויני", src: "/logos/vinni.jpeg" },
              { name: "נתנזון", src: "/logos/natanzon.jpeg" },
              { name: "קינג קונג", src: "/logos/king kong.jpeg" },
            ].map((brand) => (
              <Image
                key={brand.name}
                src={brand.src}
                alt={brand.name}
                width={120}
                height={75}
                className="object-contain"
              />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-6 bg-primary text-primary-foreground">
        <div className="container mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">מוכנים להתחיל?</h2>
          <p className="text-lg opacity-90 mb-8">
            היכנסו למערכת והתחילו לנהל את העמלות בצורה חכמה ויעילה
          </p>
          <Button size="lg" variant="secondary" asChild>
            <Link href="/sign-in" className="gap-2">
              כניסה למערכת
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 px-6 border-t">
        <div className="container mx-auto text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} La Table Group. כל הזכויות שמורות.
        </div>
      </footer>
    </main>
  );
}
