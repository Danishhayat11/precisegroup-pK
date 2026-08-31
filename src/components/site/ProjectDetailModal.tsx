/* allow-raw-color-file: architectural project gallery modal overlays amber/emerald badges on dark gallery photography */
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  BedDouble,
  Bath,
  Ruler,
  Building,
  CheckCircle2,
  Calendar,
  Layers,
  ShieldCheck,
  MessageCircle,
  Phone,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { fmtPKR } from "@/lib/format";

export type ProjectDetail = {
  id: string;
  title: string;
  category: "residential" | "commercial" | "luxury";
  type: string;
  location: string;
  subLocation: string;
  price: string;
  sqft: string;
  beds?: number;
  baths?: number;
  floors?: string;
  completion: string;
  status: string;
  images: string[];
  description: string;
  highlights: string[];
  amenities: string[];
  specs: { label: string; value: string }[];
  paymentPlan: {
    downPayment: string;
    installments: string;
    possession: string;
    duration: string;
  };
};

export const SITE_PROJECTS: Record<string, ProjectDetail> = {
  "manal-arcade": {
    id: "manal-arcade",
    title: "Manal Arcade & Shopping Galleria",
    category: "commercial",
    type: "Commercial High-Rise & Retail Arcade",
    location: "Plot #04, B-1 Markaz, Sector B-17 Multi Gardens, Islamabad",
    subLocation: "B-17 Markaz Islamabad",
    price: "PKR 1.85 Cr – 6.5 Cr",
    sqft: "450 – 2,400 sq.ft",
    floors: "Lower Ground + Ground + 5 Floors",
    completion: "Ready / Near Possession",
    status: "Delivered & Handing Over",
    images: [
      "/src/assets/site/commercial-tower-nexus.jpg",
      "/src/assets/site/project-arcade.webp",
      "/src/assets/site/project-commercial.webp",
    ],
    description:
      "Manal Arcade stands as B-17 Markaz's premier commercial landmark, engineered by Precise Group with high-traffic retail storefronts, executive corporate office suites, dual-speed passenger and cargo elevators, and dedicated underground multi-level parking. Designed for maximum rental yield and capital appreciation in Islamabad's highest-density residential zone.",
    highlights: [
      "Prime front-facing corner location on main B-17 Markaz Boulevard",
      "Guaranteed high commercial footfall with 100% active surrounding residency",
      "Reinforced earthquake-resistant RCC frame construction with CDA compliance",
      "Uninterrupted 24/7 power backup with dedicated industrial solar-hybrid generators",
    ],
    amenities: [
      "High-speed passenger & freight elevators",
      "24/7 CCTV surveillance & fire protection system",
      "Dedicated multi-level basement car parking",
      "Central HVAC provisions for retail brands",
      "Modern tiled corridors with luxury porcelain finish",
      "High-speed fiber optic internet infrastructure",
    ],
    specs: [
      { label: "Building Structure", value: "Earthquake Resistant RCC Frame" },
      { label: "Total Built-up Area", value: "48,000 sq. ft." },
      { label: "Elevators", value: "2 Passenger + 1 Cargo" },
      { label: "Power Backup", value: "100% Load Backup Generators" },
      { label: "Approvals", value: "MPCHS & CDA Approved" },
      { label: "Rental Yield", value: "Estimated 8.5% – 10.5% Annual ROI" },
    ],
    paymentPlan: {
      downPayment: "30% at Booking",
      installments: "12 Quarterly Installments (3 Years)",
      possession: "10% at Handover",
      duration: "36 Months Flexible Plan",
    },
  },
  "margalla-villa": {
    id: "margalla-villa",
    title: "Margalla View Executive Modern Villa",
    category: "residential",
    type: "1 Kanal Signature Luxury Designer Villa",
    location: "Block B, Multi Gardens Sector B-17, Islamabad",
    subLocation: "Margalla Hills View, B-17 Islamabad",
    price: "PKR 7.85 Cr",
    sqft: "4,500 sq.ft (500 Sq. Yds)",
    beds: 5,
    baths: 6,
    floors: "Basement + Ground + 1st Floor + Rooftop Lounge",
    completion: "December 2026",
    status: "Under Construction (Finishing Stage)",
    images: [
      "/src/assets/site/luxury-villa-margalla.jpg",
      "/src/assets/site/project-villa.webp",
      "/src/assets/site/project-townhouse.webp",
    ],
    description:
      "An architectural masterpiece nestled against the Margalla Hills vista in Sector B-17. Features double-height living spaces, imported Italian marble flooring, floor-to-ceiling tempered glass curtain walls, smart home automation, private infinity plunge pool, and panoramic sunset rooftop terrace.",
    highlights: [
      "Unobstructed panoramic Margalla Hills horizon views",
      "Fully integrated Smart Home lighting, climate & security automation",
      "Custom German-fitted show kitchen with built-in Bosch appliances",
      "Private landscaped lawn, heated plunge pool, and outdoor barbecue deck",
    ],
    amenities: [
      "5 King-size ensuite master bedrooms with walk-in wardrobes",
      "Italian Grohe & Kohler designer sanitary ware",
      "Double-height living atrium with natural skylight",
      "Rooftop star-gazing terrace lounge with jacuzzi",
      "2-Car covered portico garage + 2 exterior driveway slots",
      "Dual servant quarters with separate service staircase",
    ],
    specs: [
      { label: "Land Area", value: "1 Kanal (500 sq. yards)" },
      { label: "Covered Area", value: "4,500 sq. ft." },
      { label: "Flooring", value: "Imported Italian Botticino Marble" },
      { label: "Woodwork", value: "Solid Burma Teak & Ash Wood" },
      { label: "Glazing", value: "Double Glazed Low-E Thermal Glass" },
      { label: "Orientation", value: "North-East Facing (Margalla Facing)" },
    ],
    paymentPlan: {
      downPayment: "25% on Agreement",
      installments: "8 Milestone-based Construction Installments",
      possession: "15% on Key Handover",
      duration: "18 Months Construction Schedule",
    },
  },
  "sky-penthouse": {
    id: "sky-penthouse",
    title: "The Sky Penthouse Collection",
    category: "luxury",
    type: "Duplex Sky Penthouse & Private Terrace",
    location: "Top Floors, Manal Heights Tower, Islamabad",
    subLocation: "Sector B-17 Luxury Heights",
    price: "PKR 3.45 Cr – 5.20 Cr",
    sqft: "3,200 – 4,800 sq.ft",
    beds: 4,
    baths: 5,
    floors: "Dual-level Duplex with Private Elevator",
    completion: "Mid 2026",
    status: "Bookings Open / Limited Units",
    images: [
      "/src/assets/site/luxury-penthouse-sky.jpg",
      "/src/assets/site/project-penthouse.webp",
      "/src/assets/site/hero-tower.webp",
    ],
    description:
      "Perched high above Islamabad with sweeping 270-degree vistas of the capital and Margalla range. The Sky Penthouse redefines high-altitude luxury with private keycard elevator access, 20-foot double-height living salons, floating marble staircases, and wrap-around observation balconies.",
    highlights: [
      "Exclusive private express elevator with biometric access",
      "Double-height 20-foot floor-to-ceiling glass panoramic salon",
      "Extensive wrap-around balcony with glass balustrades",
      "Dedicated resident valet, concierge and private lounge",
    ],
    amenities: [
      "Master suite with bespoke dressing salon and spa bath",
      "Automated electric curtains and smart mood lighting",
      "Infinity edge rooftop pool and wellness fitness club",
      "2 Reserved underground prime parking bays with EV charger",
      "Private wine/cigar temperature-controlled cellar cabinet",
      "24/7 White-glove concierge and security dispatch",
    ],
    specs: [
      { label: "Ceiling Height", value: "20 ft Double-Height Living Atrium" },
      { label: "Private Terraces", value: "850 sq. ft. Wrap-Around Balcony" },
      { label: "Kitchen", value: "Scavolini Italian Designer Custom Fitted" },
      { label: "Elevator", value: "Dedicated Penthouse Biometric Lift" },
      { label: "Air Conditioning", value: "Concealed VRF Inverter Climate System" },
      { label: "Title", value: "Direct Registry & Sub-Lease with CDA NOC" },
    ],
    paymentPlan: {
      downPayment: "20% Down Payment",
      installments: "16 Easy Quarterly Installments (4 Years)",
      possession: "10% on Handover",
      duration: "48 Months Investor Friendly Plan",
    },
  },
  "faisal-hills-townhouse": {
    id: "faisal-hills-townhouse",
    title: "Executive Designer Townhouse Enclave",
    category: "residential",
    type: "10 Marla Urban Luxury Townhouse",
    location: "Executive Block, Faisal Hills, Islamabad",
    subLocation: "Faisal Hills GT Road Islamabad",
    price: "PKR 3.95 Cr",
    sqft: "2,700 sq.ft (250 Sq. Yds)",
    beds: 4,
    baths: 5,
    floors: "Ground + First Floor + Maid Suite",
    completion: "Ready for Possession",
    status: "Completed / Ready to Move In",
    images: [
      "/src/assets/site/project-townhouse.webp",
      "/src/assets/site/project-villa.webp",
      "/src/assets/site/luxury-villa-margalla.jpg",
    ],
    description:
      "A modern minimalist 10-Marla townhouse engineered for sophisticated urban families. Combines functional open-concept floorplans with energy-efficient thermal insulation, landscaped internal courtyard, designer open kitchen, and rooftop entertainment terrace.",
    highlights: [
      "Move-in ready with complete CDA & RDA regulatory clearances",
      "Zen landscaped internal courtyard bringing natural daylight indoors",
      "Energy-efficient solar-ready electrical infrastructure",
      "Walking distance to international school, central mosque & parks",
    ],
    amenities: [
      "4 Ensuite bedrooms with customized imported closets",
      "Modern kitchen with breakfast island and Spanish granite tops",
      "Internal courtyard garden with natural stone water feature",
      "Rooftop barbecue terrace with outdoor dining pergola",
      "Covered 2-car garage with electric motorized shutter",
      "Separate laundry and house help room with attached bath",
    ],
    specs: [
      { label: "Plot Size", value: "10 Marla (35 × 70 ft)" },
      { label: "Built-up Area", value: "2,700 sq. ft." },
      { label: "Finishes", value: "A-Grade Porcelain Tile & Oak Wood" },
      { label: "Utilities", value: "Underground Electricity, Gas & Water" },
      { label: "Possession Status", value: "100% Ready for Immediate Move-in" },
    ],
    paymentPlan: {
      downPayment: "50% Initial Payment",
      installments: "Remaining in 6 Monthly Installments",
      possession: "Immediate on 50% Clear Booking",
      duration: "Fast-Track Handover",
    },
  },
};

export function ProjectDetailModal({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  if (!projectId) return null;
  const project = SITE_PROJECTS[projectId];
  if (!project) return null;

  const currentImage = project.images[activeImageIdx] || project.images[0];

  const handleNextImage = () => {
    setActiveImageIdx((prev) => (prev + 1) % project.images.length);
  };

  const handlePrevImage = () => {
    setActiveImageIdx((prev) => (prev - 1 + project.images.length) % project.images.length);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 rounded-2xl md:rounded-3xl border-border/80 bg-card shadow-2xl">
        <div className="relative">
          {/* Main Gallery Hero */}
          <div className="relative aspect-[16/9] md:aspect-[21/9] w-full overflow-hidden bg-black/90">
            <img
              src={currentImage}
              alt={project.title}
              className="w-full h-full object-cover transition-all duration-500"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

            {/* Category / Status Badges */}
            <div className="absolute top-4 left-4 flex flex-wrap gap-2 z-10">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500 text-black shadow-md uppercase tracking-wider">
                {project.category}
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-black/60 backdrop-blur-md text-white border border-white/20">
                {project.status}
              </span>
            </div>

            {/* Navigation Arrows */}
            {project.images.length > 1 && (
              <div className="absolute inset-y-0 inset-x-3 flex items-center justify-between pointer-events-none">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handlePrevImage}
                  className="pointer-events-auto rounded-full bg-black/50 hover:bg-black/80 text-white border-white/20 h-11 w-11 min-h-11 min-w-11 backdrop-blur-md"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleNextImage}
                  className="pointer-events-auto rounded-full bg-black/50 hover:bg-black/80 text-white border-white/20 h-11 w-11 min-h-11 min-w-11 backdrop-blur-md"
                  aria-label="Next image"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            )}

            {/* Bottom Title Bar on Image */}
            <div className="absolute bottom-4 left-4 right-4 text-white z-10">
              <DialogTitle className="text-xl md:text-3xl font-bold tracking-tight text-white drop-shadow-md">
                {project.title}
              </DialogTitle>
              <p className="text-xs md:text-sm text-white/80 flex items-center gap-1.5 mt-1">
                <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{project.location}</span>
              </p>
            </div>
          </div>

          {/* Thumbnail Strip */}
          {project.images.length > 1 && (
            <div className="flex gap-2 p-3 bg-muted/70 border-b border-border/60 overflow-x-auto">
              {project.images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveImageIdx(idx)}
                  className={`relative w-20 h-14 rounded-lg overflow-hidden shrink-0 border-2 transition-all ${
                    activeImageIdx === idx
                      ? "border-primary ring-2 ring-primary/20 scale-105"
                      : "border-transparent opacity-70 hover:opacity-100"
                  }`}
                >
                  <img src={img} alt="Thumbnail" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Content Body */}
          <div className="p-6 md:p-8 space-y-6">
            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-muted/40 border border-border/70 text-center">
              <div className="p-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Investment Value
                </div>
                <div className="text-base md:text-lg font-bold text-primary mt-0.5">
                  {project.price}
                </div>
              </div>

              <div className="p-2 border-l border-border/50">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Covered Area
                </div>
                <div className="text-base md:text-lg font-bold text-foreground mt-0.5">
                  {project.sqft}
                </div>
              </div>

              <div className="p-2 border-l border-border/50">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Configuration
                </div>
                <div className="text-base md:text-lg font-bold text-foreground mt-0.5">
                  {project.beds
                    ? `${project.beds} Beds · ${project.baths} Baths`
                    : project.floors || "Custom Floorplan"}
                </div>
              </div>

              <div className="p-2 border-l border-border/50">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Possession
                </div>
                <div className="text-base md:text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {project.completion}
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2 flex items-center gap-2">
                <Building className="w-4 h-4 text-primary" />
                Project Architectural Overview
              </h4>
              <p className="text-sm leading-relaxed text-muted-foreground">{project.description}</p>
            </div>

            {/* Highlights Grid */}
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Signature Features &amp; Engineering Distinctions
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {project.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-card border border-border/70 text-xs text-foreground/90 font-medium"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Technical Specifications */}
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Technical Specifications &amp; Approvals
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {project.specs.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/50"
                  >
                    <span className="text-muted-foreground font-medium">{s.label}</span>
                    <span className="font-semibold text-foreground">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Amenities Checklist */}
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                Exclusive Amenities &amp; Infrastructure
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {project.amenities.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Schedule Card */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-primary/5 via-card to-amber-500/5 border border-primary/20">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-primary" />
                Structured Investor Payment Plan
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-card border border-border/60">
                  <div className="text-muted-foreground font-medium">Down Payment</div>
                  <div className="font-bold text-foreground mt-1">
                    {project.paymentPlan.downPayment}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-card border border-border/60">
                  <div className="text-muted-foreground font-medium">Installments</div>
                  <div className="font-bold text-foreground mt-1">
                    {project.paymentPlan.installments}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-card border border-border/60">
                  <div className="text-muted-foreground font-medium">On Possession</div>
                  <div className="font-bold text-foreground mt-1">
                    {project.paymentPlan.possession}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-card border border-border/60">
                  <div className="text-muted-foreground font-medium">Tenure</div>
                  <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {project.paymentPlan.duration}
                  </div>
                </div>
              </div>
            </div>

            {/* Action CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border/70">
              <div className="text-xs text-muted-foreground text-center sm:text-left">
                Direct booking assistance &amp; private site viewing available 7 days a week.
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Button
                  asChild
                  className="flex-1 sm:flex-none min-h-11 rounded-xl bg-primary text-primary-foreground font-semibold shadow-md"
                >
                  <a
                    href={`https://wa.me/923445533767?text=Hello%20Precise%20Group,%20I%20am%20interested%20in%20booking%20or%20viewing%20${encodeURIComponent(
                      project.title,
                    )}.`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Book Private Tour
                  </a>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="flex-1 sm:flex-none min-h-11 rounded-xl font-medium"
                >
                  <a
                    href="tel:+923445533767"
                    className="inline-flex items-center justify-center gap-2"
                  >
                    <Phone className="w-4 h-4 text-primary" />
                    Call Sales Office
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
