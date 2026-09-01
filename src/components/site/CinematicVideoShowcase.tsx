/* allow-raw-color-file: cinematic video player overlays gold/amber accent controls on dark 4K video canvas */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Sparkles,
  Compass,
  ArrowRight,
  Eye,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import luxuryVillaMargalla from "@/assets/site/luxury-villa-margalla.jpg";
import commercialTowerNexus from "@/assets/site/commercial-tower-nexus.jpg";
import luxuryPenthouseSky from "@/assets/site/luxury-penthouse-sky.jpg";
import manalHeightsPoster from "@/assets/site/manal-heights-actual-poster.jpg";

type VideoScene = {
  id: string;
  projectId: string;
  title: string;
  subtitle: string;
  tag: string;
  duration: string;
  image: string;
  specs: string[];
  description: string;
  viewCount: string;
  externalVideoUrl?: string;
};

const SCENES: VideoScene[] = [
  {
    id: "manal-heights-3d",
    projectId: "manal-heights",
    title: "Manal Heights — H-13 Islamabad",
    subtitle: "3D Architectural Flythrough & Luxury Suites Showcase",
    tag: "Manal Heights H-13",
    duration: "4K HDR · 03:45",
    image: manalHeightsPoster,
    specs: [
      "NUST Service Road H-13",
      "Semi-Furnished Luxury Suites",
      "Double-Height Shopping Atrium",
      "10 Mins from Airport",
    ],
    description:
      "Experience the architectural grandeur of Manal Heights on NUST Service Road: staggered cantilevered balconies with lush planter greenery, double-height shopping arcade, and luxury semi-furnished suites.",
    viewCount: "14.2K Views",
    externalVideoUrl: "https://www.facebook.com/share/v/18hJQwxFdK/?mibextid=wwXIfr",
  },
  {
    id: "villa-tour",
    projectId: "margalla-villa",
    title: "Margalla Hills Signature Villa",
    subtitle: "Architectural 3D Walkthrough & Mountain Vista Preview",
    tag: "Residential Luxury",
    duration: "4K 60FPS · 02:45",
    image: luxuryVillaMargalla,
    specs: [
      "1 Kanal Covered Area",
      "5 Ensuite Master Suites",
      "Heated Infinity Plunge Pool",
      "Smart Living Automation",
    ],
    description:
      "Experience the pinnacle of Margalla vista living with seamless indoor-outdoor architectural flow, double-height natural light salons, and private sunset terraces.",
    viewCount: "4.8K Views",
  },
  {
    id: "nexus-arcade",
    projectId: "manal-arcade",
    title: "Manal Arcade & Shopping Galleria",
    subtitle: "High-Traffic Commercial & Retail Architecture",
    tag: "Commercial Hub",
    duration: "4K 60FPS · 03:10",
    image: commercialTowerNexus,
    specs: [
      "B-17 Markaz Corner",
      "48,000 sq.ft Built-Up Area",
      "High-Speed Elevators",
      "Multi-Level Basement Parking",
    ],
    description:
      "Take an interactive virtual flight through Islamabad B-17's premier retail arcade, corporate executive suites, and panoramic glass atrium corridors.",
    viewCount: "6.2K Views",
  },
  {
    id: "penthouse-sky",
    projectId: "sky-penthouse",
    title: "The Sky Penthouse Collection",
    subtitle: "Duplex High-Rise Observation Living",
    tag: "Exclusive Penthouses",
    duration: "4K 60FPS · 02:15",
    image: luxuryPenthouseSky,
    specs: [
      "20 ft Double-Height Ceiling",
      "Private Biometric Elevator",
      "270° Panoramic City Views",
      "Italian Designer Fitout",
    ],
    description:
      "Perched on the highest tiers of Islamabad, witness the interplay of marble elegance, custom chandeliers, and unhindered horizon vistas.",
    viewCount: "3.9K Views",
  },
];

export function CinematicVideoShowcase({
  onSelectProject,
}: {
  onSelectProject?: (projectId: string) => void;
}) {
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [showEmbed, setShowEmbed] = useState(false);

  const activeScene = SCENES[activeSceneIdx];

  // Reset embed state when switching scenes
  useEffect(() => {
    setShowEmbed(false);
  }, [activeSceneIdx]);

  // Simulated playback progression
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          // Auto switch to next scene when video finishes
          setActiveSceneIdx((current) => (current + 1) % SCENES.length);
          return 0;
        }
        return prev + 1.25;
      });
    }, 120);
    return () => clearInterval(interval);
  }, [isPlaying, activeSceneIdx]);

  return (
    <section className="my-16 md:my-24" aria-label="Cinematic Architectural Walkthroughs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Cinematic 3D Video Renders</span>
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-foreground">
              Virtual Architectural Tours &amp; Drone Showcases
            </h2>
            <p className="text-sm md:text-base text-muted-foreground mt-2 max-w-2xl">
              Immerse yourself in our premier Islamabad real estate developments through interactive
              4K video simulations and architectural walkthroughs.
            </p>
          </div>

          {/* Scene selector tabs */}
          <div className="flex items-center gap-1.5 bg-muted/60 p-1.5 rounded-2xl border border-border/60 self-start md:self-auto overflow-x-auto">
            {SCENES.map((scene, idx) => (
              <button
                key={scene.id}
                onClick={() => {
                  setActiveSceneIdx(idx);
                  setProgress(0);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                  activeSceneIdx === idx
                    ? "bg-card text-foreground shadow-sm border border-border/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {scene.tag}
              </button>
            ))}
          </div>
        </div>

        {/* Video Player Display Container */}
        <div className="relative rounded-3xl overflow-hidden border border-border/80 bg-black shadow-2xl aspect-[16/9] md:aspect-[21/9] group">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeScene.id}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{
                opacity: 1,
                scale: isPlaying ? [1, 1.04] : 1,
              }}
              exit={{ opacity: 0 }}
              transition={{
                scale: {
                  duration: 8,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                },
                opacity: { duration: 0.6 },
              }}
              className="absolute inset-0 w-full h-full"
            >
              <img
                src={activeScene.image}
                alt={activeScene.title}
                className="w-full h-full object-cover"
              />
            </motion.div>
          </AnimatePresence>

          {/* Cinematic Vignette & Lighting Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/40 pointer-events-none" />
          <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-black/60 pointer-events-none" />

          {/* Live Recording Watermark */}
          <div className="absolute top-4 left-4 sm:top-6 sm:left-6 flex items-center gap-3 z-20">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>4K CINEMATIC TOUR</span>
            </div>

            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/80 text-xs">
              <Eye className="w-3.5 h-3.5 text-amber-400" />
              {activeScene.viewCount}
            </span>
          </div>

          {/* Audio & Control Buttons Top Right */}
          <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 z-20">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2.5 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white transition-colors"
              aria-label={isMuted ? "Unmute audio" : "Mute audio"}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              onClick={() => {
                if (onSelectProject) {
                  const mapId =
                    activeScene.id === "villa-tour"
                      ? "margalla-villa"
                      : activeScene.id === "nexus-arcade"
                        ? "manal-arcade"
                        : "sky-penthouse";
                  onSelectProject(mapId);
                }
              }}
              className="p-2.5 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white transition-colors"
              aria-label="View project details"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          {/* Center Interactive Play/Pause Button */}
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (activeScene.externalVideoUrl) {
                  setShowEmbed(true);
                } else {
                  setIsPlaying(!isPlaying);
                }
              }}
              className="pointer-events-auto w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-amber-500/90 hover:bg-amber-400 text-black flex items-center justify-center shadow-[0_0_40px_rgba(201,168,76,0.5)] transition-colors backdrop-blur-sm"
              aria-label={
                activeScene.externalVideoUrl
                  ? "Watch 3D Video"
                  : isPlaying
                    ? "Pause walkthrough"
                    : "Play walkthrough"
              }
            >
              {!activeScene.externalVideoUrl && isPlaying ? (
                <Pause className="w-7 h-7 sm:w-8 sm:h-8 fill-black" />
              ) : (
                <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-black translate-x-0.5" />
              )}
            </motion.button>
          </div>

          {/* Actual Video Embed Overlay */}
          <AnimatePresence>
            {showEmbed && activeScene.externalVideoUrl && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-black flex items-center justify-center"
              >
                <button
                  onClick={() => setShowEmbed(false)}
                  className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/60 hover:bg-black/90 text-white border border-white/20 backdrop-blur-md transition-all"
                  aria-label="Close video"
                >
                  <X className="w-5 h-5" />
                </button>
                <iframe
                  src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
                    activeScene.externalVideoUrl,
                  )}&show_text=false&width=auto`}
                  className="w-full h-full border-none shadow-2xl"
                  style={{ border: "none", overflow: "hidden" }}
                  scrolling="no"
                  frameBorder="0"
                  allowFullScreen={true}
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                  title={activeScene.title}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Info & Video Scrubber Bar */}
          <div className="absolute bottom-0 inset-x-0 p-5 sm:p-8 text-white z-20">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4">
              <div className="max-w-2xl">
                <div className="text-amber-400 text-xs uppercase tracking-widest font-bold mb-1 flex items-center gap-2">
                  <Compass className="w-3.5 h-3.5" />
                  {activeScene.subtitle}
                </div>
                <h3 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white drop-shadow-md">
                  {activeScene.title}
                </h3>
                <p className="text-xs sm:text-sm text-white/80 line-clamp-2 mt-1">
                  {activeScene.description}
                </p>

                {/* Specs Chips */}
                <div className="hidden sm:flex flex-wrap gap-2 mt-3">
                  {activeScene.specs.map((spec, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/10 backdrop-blur-md border border-white/15 text-white/90"
                    >
                      {spec}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="shrink-0 flex flex-wrap items-center gap-3">
                {activeScene.externalVideoUrl && (
                  <Button
                    onClick={() => setShowEmbed(true)}
                    variant="outline"
                    className="bg-black/60 hover:bg-black/80 text-white border-white/30 font-semibold rounded-xl px-4 backdrop-blur-md inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Watch Full 3D Reel</span>
                  </Button>
                )}

                <Button
                  onClick={() => {
                    if (onSelectProject) {
                      onSelectProject(activeScene.projectId);
                    }
                  }}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl px-5 shadow-lg"
                >
                  <span>Explore Project</span>
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>

            {/* Video Progress Scrubber Bar */}
            <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden backdrop-blur-sm cursor-pointer relative">
              <div
                className="bg-amber-400 h-full rounded-full transition-all duration-100 relative"
                style={{ width: `${progress}%` }}
              >
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md" />
              </div>
            </div>

            <div className="flex justify-between items-center text-[10px] text-white/60 mt-1.5 font-mono">
              <span>
                00:
                {Math.floor(progress * 0.6)
                  .toString()
                  .padStart(2, "0")}
              </span>
              <span>{activeScene.duration}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
