/* allow-raw-color-file: executive profile modal overlays gold/amber/emerald badges on profile cards */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Phone,
  Mail,
  Award,
  Building,
  Briefcase,
  GraduationCap,
  CheckCircle2,
  MessageCircle,
  Sparkles,
  Quote,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import teamMushtaq from "@/assets/site/team-mushtaq.jpg";
import teamDanish from "@/assets/site/team-danish.jpg";
import teamSaeed from "@/assets/site/team-saeed.jpg";

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  department: string;
  credentials?: string;
  phone: string;
  email: string;
  image: string;
  quote: string;
  attire: string;
  stats: { label: string; value: string }[];
  bio: string[];
  achievements: string[];
  projects: string[];
  specialization: string;
};

export const TEAM_MEMBERS: Record<string, TeamMember> = {
  mushtaq: {
    id: "mushtaq",
    name: "Engr. Mushtaq Ahmad",
    role: "Chief Executive Officer & Founder",
    department: "Executive Leadership",
    credentials: "B.Sc. Civil Engineering (UET) · PEC Registered Professional Engineer",
    phone: "+92 344 5533767",
    email: "mushtaq@precisegroup.pk",
    image: teamMushtaq,
    quote:
      "Engineering is not merely assembling concrete and steel; it is the sacred responsibility of building generational trust and architectural monuments that stand unbroken for decades.",
    attire:
      "Bespoke Italian midnight-navy wool tailored suit, spread-collar Egyptian cotton shirt, textured silk necktie, and an executive timepiece — reflecting timeless leadership and structural mastery.",
    stats: [
      { label: "Civil Construction", value: "1.5M+ Sq. Ft." },
      { label: "Industry Mastery", value: "20+ Years" },
      { label: "Delivery Ethics", value: "100% Zero-Debt" },
    ],
    specialization: "Structural Engineering, Master Planning & Real Estate Portfolio Development",
    bio: [
      "Engr. Mushtaq Ahmad is the founding visionary behind Precise Realtors & Builders (Pvt.) Ltd. With over two decades of hands-on structural engineering and real estate development leadership across Islamabad, Rawalpindi, and KP, he has pioneered landmark commercial and residential developments adhering to uncompromising engineering standards.",
      "His technical acumen and transparent client-first ethos have established Precise Group as a benchmark of integrity, zero-debt project delivery, and prime capital appreciation in B-17 Multi Gardens, Faisal Hills, and New Islamabad sectors.",
    ],
    achievements: [
      "Over 1.5 Million+ sq. ft. of structural civil construction delivered on schedule",
      "Pioneered the flagship Manal Arcade & Manal Heights commercial plazas in B-17 Markaz",
      "Executive Council Advisor on Islamabad Urban Development & Real Estate Ethics",
      "Over 1,200+ satisfied residential & commercial unit owners across Pakistan and diaspora",
    ],
    projects: [
      "Manal Arcade (B-17 Markaz)",
      "Manal Heights (Sector B-17)",
      "Precise Executive Residency",
      "Margalla Valley Heights",
    ],
  },
  danish: {
    id: "danish",
    name: "Engr. Danish Hayat",
    role: "Director of Engineering & Business Operations",
    department: "Engineering & Technical Operations",
    credentials:
      "B.Sc. Mechanical / Industrial Engineering · Project Management Professional (PMP)",
    phone: "+92 337 0129621",
    email: "danish@precisegroup.pk",
    image: teamDanish,
    quote:
      "Simplicity and precision are the ultimate forms of sophistication. When construction discipline merges seamlessly with digital intelligence, zero-defect delivery becomes the standard.",
    attire:
      "Modern Steve Jobs-inspired executive tech aesthetic: sharp Italian charcoal wool tailored blazer over a fine-gauge black merino turtleneck with minimalist titanium timepiece — embodying innovation, clarity, and precision.",
    stats: [
      { label: "Turnaround Boost", value: "+24% Efficiency" },
      { label: "ERP Infrastructure", value: "Proprietary Core" },
      { label: "Global Reach", value: "GCC / UK / USA" },
    ],
    specialization:
      "Operations Automation, ERP Infrastructure, Project Execution & Modern Architecture",
    bio: [
      "Engr. Danish Hayat spearheads engineering operations, digital project execution, and enterprise resource governance across Precise Group. He integrates cutting-edge construction technology, precision cost control, and digital ERP systems to ensure millimetric construction quality and real-time financial transparency.",
      "Leading technical procurement, structural site audits, and international business strategy, Danish guarantees that all Precise developments meet international building codes and high-yield investment timelines.",
    ],
    achievements: [
      "Architected the proprietary Precise Enterprise Resource Planning (ERP) platform",
      "Streamlined on-site construction timelines reducing project turnaround by 24%",
      "Implemented strict zero-tolerance structural material quality assurance protocols",
      "Overseeing overseas investor relations across GCC, UK, and North America",
    ],
    projects: [
      "Nexus Commercial Arcade",
      "Precise Executive Suites",
      "Faisal Hills Sky Villas",
      "B-17 Luxury Penthouse Enclave",
    ],
  },
  saeed: {
    id: "saeed",
    name: "Saeed Ullah",
    role: "Head of Sales & Client Relations",
    department: "Client Advisory & Investor Relations",
    credentials: "BBA Marketing & Real Estate Investment Management",
    phone: "+92 344 5533767",
    email: "sales@precisegroup.pk",
    image: teamSaeed,
    quote:
      "True wealth in real estate is built on clarity, uncompromising honesty, and strategic foresight. Every client relationship is a lifelong partnership.",
    attire:
      "Bespoke 3-piece tailored slate-grey suit with handcrafted vest, crisp French cuff shirt with gold cufflinks, and jacquard patterned silk tie — projecting distinction, poise, and welcoming elegance.",
    stats: [
      { label: "Transactions Closed", value: "PKR 4.5B+" },
      { label: "Client Retention", value: "98% Repeat" },
      { label: "Overseas Portfolios", value: "500+ Active" },
    ],
    specialization: "Commercial Real Estate Sales, Portfolio Advisory, Client Wealth Management",
    bio: [
      "Saeed Ullah directs client relations, private wealth portfolio management, and commercial leasing for Precise Group. With an intimate understanding of capital gains velocity in Islamabad's high-growth sectors, he advises private investors, corporate entities, and overseas Pakistanis on high-ROI asset acquisition.",
      "Known for his dedication to personalized customer journeys, Saeed ensures seamless title transfers, flexible installment restructuring, and comprehensive post-possession leasing support.",
    ],
    achievements: [
      "Closed over PKR 4.5+ Billion in residential and commercial real estate transactions",
      "Maintains a 98% client retention and repeat investment rate",
      "Dedicated concierge support for 500+ Overseas Pakistani investors worldwide",
      "Spearheaded multi-brand retail leasing for B-17 commercial centers",
    ],
    projects: [
      "Manal Arcade Retail Portfolio",
      "Multi Gardens Residential Enclave",
      "B-17 Commercial Hub",
      "Margalla View Townhouses",
    ],
  },
};

export function TeamModal({
  memberId,
  open,
  onOpenChange,
}: {
  memberId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!memberId) return null;
  const member = TEAM_MEMBERS[memberId];
  if (!member) return null;

  const whatsappClean = member.phone.replace(/[^\d]/g, "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl md:rounded-3xl border-border/80 bg-card shadow-2xl">
        <div className="relative">
          {/* Header Banner */}
          <div className="h-32 md:h-40 bg-gradient-to-r from-primary/20 via-primary/10 to-amber-500/10 border-b border-border/50 relative overflow-hidden">
            <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#c9a84c_1px,transparent_1px)] [background-size:16px_16px]" />
          </div>

          <div className="px-6 md:px-8 pb-8 -mt-16 relative z-10">
            {/* Top Identity Block */}
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5 mb-6">
              <div className="w-28 h-36 md:w-36 md:h-44 rounded-2xl overflow-hidden border-4 border-card shadow-xl shrink-0 bg-muted">
                <img
                  src={member.image}
                  alt={member.name}
                  className="w-full h-full object-cover object-top"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-2">
                  <Briefcase className="w-3.5 h-3.5" />
                  {member.department}
                </div>
                <DialogTitle className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                  {member.name}
                </DialogTitle>
                <p className="text-base font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                  {member.role}
                </p>
                {member.credentials && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1.5">
                    <GraduationCap className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span>{member.credentials}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Executive Stat Pillars */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {member.stats.map((s, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-2xl bg-card border border-border/70 shadow-sm text-center"
                >
                  <div className="text-base md:text-lg font-bold text-foreground tracking-tight">
                    {s.value}
                  </div>
                  <div className="text-[11px] font-medium text-muted-foreground mt-0.5">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Quote Callout */}
            <div className="p-4 md:p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-card to-primary/10 border border-amber-500/30 mb-6 relative overflow-hidden">
              <Quote className="w-8 h-8 text-amber-500/20 absolute -top-1 -right-1" />
              <p className="text-xs md:text-sm font-serif italic text-foreground/90 leading-relaxed">
                "{member.quote}"
              </p>
            </div>

            {/* Sartorial Style & Professional Dressing */}
            <div className="p-4 rounded-2xl bg-muted/40 border border-border/70 mb-6">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Executive Sartorial Style &amp; Poise
                </h4>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{member.attire}</p>
            </div>

            {/* Quick Action Bar */}
            <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-muted/50 border border-border/60 mb-6">
              <Button asChild size="sm" className="min-h-10 font-medium shadow-sm">
                <a
                  href={`https://wa.me/${whatsappClean}?text=Hello%20${encodeURIComponent(member.name)},%20I%20would%20like%20to%20inquire%20about%20Precise%20Group%20real%20estate%20projects.`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp Direct
                </a>
              </Button>

              <Button asChild variant="outline" size="sm" className="min-h-10 font-medium">
                <a href={`tel:${member.phone}`} className="inline-flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  {member.phone}
                </a>
              </Button>

              <Button asChild variant="outline" size="sm" className="min-h-10 font-medium">
                <a href={`mailto:${member.email}`} className="inline-flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" />
                  {member.email}
                </a>
              </Button>
            </div>

            {/* Biography */}
            <div className="space-y-3 mb-6">
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <Building className="w-4 h-4 text-primary" />
                Executive Leadership Profile
              </h4>
              {member.bio.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
            </div>

            {/* Key Achievements Grid */}
            <div className="mb-6">
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2 mb-3">
                <Award className="w-4 h-4 text-amber-500" />
                Track Record &amp; Distinctions
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {member.achievements.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-card border border-border/70 text-xs text-foreground/90 font-medium"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Project Portfolio */}
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2 mb-3">
                <Building className="w-4 h-4 text-primary" />
                Key Project Oversight
              </h4>
              <div className="flex flex-wrap gap-2">
                {member.projects.map((proj, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-muted text-foreground border border-border/80"
                  >
                    {proj}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
