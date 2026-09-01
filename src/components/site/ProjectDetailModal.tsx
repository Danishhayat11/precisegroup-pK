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
  Play,
  TrendingUp,
} from "lucide-react";
import { fmtPKR } from "@/lib/format";
import manalHeightsElevation from "@/assets/site/manal-heights-actual-elevation.jpg";
import manalHeightsUltra from "@/assets/site/manal-heights-ultra.jpg";
import manalHeightsPoster from "@/assets/site/manal-heights-actual-poster.jpg";
import manalHeightsAtriumActual from "@/assets/site/manal-heights-actual-atrium.jpg";
import manalHeightsFloorplanActual from "@/assets/site/manal-heights-actual-floorplan.jpg";
import manalHeightsH13Infographic from "@/assets/site/manal-heights-h13-infographic.jpg";
import manalHeightsFacade from "@/assets/site/manal-heights-facade.jpg";

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
  videoUrl?: string;
  videoTitle?: string;
  paymentPlan: {
    downPayment: string;
    installments: string;
    possession: string;
    duration: string;
  };
};

export const SITE_PROJECTS: Record<string, ProjectDetail> = {
  "manal-heights": {
    id: "manal-heights",
    title: "Manal Heights — H-13 Islamabad",
    category: "luxury",
    type: "Shops, Semi-Furnished Studio & 2-Bed Luxury Apartments, Offices",
    location: "NUST Service Road, Sector H-13, Islamabad",
    subLocation: "Walking distance to NUST University (10 Mins from Airport)",
    price: "PKR 95 Lacs – 2.85 Cr",
    sqft: "420 – 1,850 sq.ft",
    beds: 2,
    baths: 2,
    floors: "Lower Ground + Ground + 7 Floors + Sky Lounge",
    completion: "Rapid Construction · 2026",
    status: "Bookings Open · Limited Units Available",
    videoUrl: "https://www.facebook.com/share/v/18hJQwxFdK/?mibextid=wwXIfr",
    videoTitle: "Official 3D Architectural Reel & Building Showcase",
    images: [
      manalHeightsUltra,
      manalHeightsElevation,
      manalHeightsPoster,
      manalHeightsAtriumActual,
      manalHeightsFloorplanActual,
      manalHeightsH13Infographic,
      manalHeightsFacade,
    ],
    description:
      "Manal Heights is an authentic landmark development strategically positioned on NUST Service Road in Sector H-13 Islamabad. Featuring contemporary architecture with staggered cantilevered balconies with integrated planter boxes, ground-floor supermarket and commercial retail arcade, double-height shopping atrium, corporate executive offices, and semi-furnished luxury studio and 2-bedroom residential suites.",
    highlights: [
      "Authentic Building Architecture: Staggered cantilevered balconies with green planters & glass railings",
      "Prime NUST Location: Walking distance to Pakistan's #1 University (NUST) on NUST Service Road",
      "Airport & Motorway: 10 mins (10 Km) from Islamabad Int'l Airport via Srinagar Highway & M-1/M-2",
      "High Rental Yield: Massive demand from students, faculty, and executives with Airbnb potential",
      "Regulatory Clearances: Approved sector H-13 by CDA ICT with booming infrastructure",
    ],
    amenities: [
      "Double-height commercial shopping atrium with grand staircase & retail brands",
      "Semi-furnished designer studio & 2-bed apartments with private balconies",
      "Dual high-speed passenger & cargo elevators with 100% generator power backup",
      "Rooftop pergola sky terrace with panoramic Margalla & Islamabad views",
      "Underground multi-level secure parking with automated access control",
      "24/7 CCTV surveillance, smart intercom, and dedicated maintenance facility",
    ],
    specs: [
      { label: "Location Advantage", value: "NUST Service Road, H-13 Islamabad" },
      { label: "Proximity to NUST", value: "Walking Distance to Campus" },
      { label: "Airport Proximity", value: "10 Km / 10 Minutes Drive" },
      { label: "Apartment Types", value: "Semi-Furnished Studio & 2-Bed Suites" },
      { label: "Commercial Retail", value: "Double-Height Atrium & Supermarket" },
      { label: "Approval & Title", value: "CDA / ICT Approved Project" },
    ],
    paymentPlan: {
      downPayment: "25% at Booking",
      installments: "Easy Quarterly & Monthly Installments",
      possession: "15% on Handover",
      duration: "Flexible 36-Month Investor Plan",
    },
  },
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
  "fb-project-1": {
    id: "fb-project-1",
    title: "Modern High-Rise Apartment [Mock Data]",
    category: "residential",
    type: "Luxury Apartment",
    location: "Downtown Commercial District",
    subLocation: "City Center",
    price: "PKR 4.50 Cr",
    sqft: "1,500 sq.ft",
    beds: 3,
    baths: 3,
    floors: "12th Floor",
    completion: "Ready to Move",
    status: "Available",
    images: [
      "/src/assets/site/project-tower.webp"
    ],
    description: "This is a placeholder description for a real project from Facebook. You can replace this text with the actual project details, highlights, and amenities later. It serves as a visual layout reference.",
    highlights: [
      "[Placeholder Highlight 1: e.g. Smart Home Features]",
      "[Placeholder Highlight 2: e.g. Panoramic City Views]",
      "[Placeholder Highlight 3: e.g. Dedicated Parking]"
    ],
    amenities: [
      "[Placeholder Amenity 1: Swimming Pool]",
      "[Placeholder Amenity 2: Gym]",
      "[Placeholder Amenity 3: 24/7 Security]"
    ],
    specs: [
      { label: "Plot Size", value: "N/A" },
      { label: "Built-up Area", value: "1,500 sq. ft." }
    ],
    paymentPlan: {
      downPayment: "20% Initial Payment",
      installments: "48 Monthly Installments",
      possession: "On Completion",
      duration: "4 Years"
    }
  },
  "fb-project-2": {
    id: "fb-project-2",
    title: "Luxury Commercial Complex [Mock Data]",
    category: "commercial",
    type: "Commercial Hub",
    location: "Main Boulevard",
    subLocation: "Financial District",
    price: "PKR 12.0 Cr",
    sqft: "5,000 sq.ft",
    floors: "Ground + 2",
    completion: "Under Construction",
    status: "Booking Open",
    images: [
      "/src/assets/site/project-commercial.webp"
    ],
    description: "This is another placeholder for a Facebook project. Replace this description with the real commercial project details, ensuring the structure matches your luxury brand.",
    highlights: [
      "[Placeholder Highlight: High Footfall Area]",
      "[Placeholder Highlight: Corner Plot Advantage]"
    ],
    amenities: [
      "[Placeholder Amenity: Backup Generators]",
      "[Placeholder Amenity: High Speed Elevators]"
    ],
    specs: [
      { label: "Commercial Area", value: "5,000 sq. ft." }
    ],
    paymentPlan: {
      downPayment: "30% Initial Payment",
      installments: "Quarterly Installments",
      possession: "2027",
      duration: "3 Years"
    }
  },
  "fb-project-3": {
    id: "fb-project-3",
    title: "Exclusive Suburb Villa [Mock Data]",
    category: "luxury",
    type: "Signature Villa",
    location: "Premium Golf Estate",
    subLocation: "Phase 1",
    price: "PKR 9.50 Cr",
    sqft: "4,000 sq.ft",
    beds: 5,
    baths: 6,
    floors: "Basement + Ground + 1",
    completion: "Ready for Possession",
    status: "Sold Out",
    images: [
      "/src/assets/site/project-villa.webp"
    ],
    description: "A final placeholder for a luxury villa project from your Facebook page. Replace the text and images to quickly integrate the real project into your pristine portfolio.",
    highlights: [
      "[Placeholder Highlight: Golf Course Facing]",
      "[Placeholder Highlight: Italian Kitchen]"
    ],
    amenities: [
      "[Placeholder Amenity: Private Pool]",
      "[Placeholder Amenity: Servant Quarters]"
    ],
    specs: [
      { label: "Land Area", value: "1 Kanal" }
    ],
    paymentPlan: {
      downPayment: "100% Upfront",
      installments: "N/A",
      possession: "Immediate",
      duration: "Ready"
    }
  }
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
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 rounded-[2rem] border-border/20 bg-card/85 backdrop-blur-3xl shadow-[0_40px_80px_rgb(0,0,0,0.4)]">
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
                  className={`relative w-24 h-16 rounded-xl overflow-hidden shrink-0 border-2 transition-all duration-300 ${
                    activeImageIdx === idx
                      ? "border-primary ring-2 ring-primary/30 scale-105 shadow-lg"
                      : "border-transparent opacity-60 hover:opacity-100 hover:scale-105"
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-3xl bg-muted/30 border border-border/40 text-center shadow-inner">
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

            {/* 3D Video Walkthrough & Virtual Tour (If available) */}
            {project.videoUrl && (
              <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-primary/10 p-5 shadow-lg">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                      <Sparkles className="w-3 h-3" />
                      4K 3D Architectural Cinematic
                    </div>
                    <h4 className="text-base font-bold text-foreground">
                      {project.videoTitle || "Experience the 3D Architectural Walkthrough"}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Watch the high-definition architectural flythrough, retail atrium, and luxury apartment interiors.
                    </p>
                  </div>
                  <Button
                    asChild
                    className="min-h-12 shrink-0 rounded-full bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg gap-2 transition-all hover:scale-105"
                  >
                    <a
                      href={project.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      Watch 3D Video
                      <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                    </a>
                  </Button>
                </div>
                {/* Embed Facebook Reel if it's the Manal Heights Video */}
                {project.id === "manal-heights" && (
                  <div className="mt-6 flex justify-center w-full overflow-hidden rounded-xl bg-black">
                    <iframe 
                      src="https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fv%2F18hJQwxFdK%2F%3Fmibextid%3DwwXIfr&show_text=false&width=500" 
                      width="500" 
                      height="889" 
                      style={{ border: "none", overflow: "hidden", maxWidth: "100%", maxHeight: "70vh" }} 
                      scrolling="no" 
                      frameBorder="0" 
                      allowFullScreen={true} 
                      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                    ></iframe>
                  </div>
                )}
              </div>
            )}

            {/* Payment Schedule Card */}
            <div className="p-6 rounded-3xl bg-gradient-to-br from-primary/10 via-card to-amber-500/10 border border-primary/20 shadow-lg">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-primary" />
                Structured Investor Payment Plan
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/40">
                  <div className="text-muted-foreground font-medium">Down Payment</div>
                  <div className="font-bold text-foreground mt-1">
                    {project.paymentPlan.downPayment}
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/40">
                  <div className="text-muted-foreground font-medium">Installments</div>
                  <div className="font-bold text-foreground mt-1">
                    {project.paymentPlan.installments}
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/40">
                  <div className="text-muted-foreground font-medium">On Possession</div>
                  <div className="font-bold text-foreground mt-1">
                    {project.paymentPlan.possession}
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/40">
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
                  className="flex-1 sm:flex-none min-h-12 rounded-full bg-primary text-primary-foreground font-semibold shadow-lg transition-all hover:scale-105"
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
                  className="flex-1 sm:flex-none min-h-12 rounded-full font-medium transition-all hover:scale-105"
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
