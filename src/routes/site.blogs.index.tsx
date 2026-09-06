import { createFileRoute, Link } from '@tanstack/react-router';
import { BLOG_POSTS } from '../lib/blogData';

export const Route = createFileRoute('/site/blogs/')({
  component: BlogsIndexPage,
  head: () => ({
    meta: [
      { title: 'Blogs | Precise Group' },
      { name: 'description', content: 'Read the latest insights on property investment, construction, and real estate technology by Precise Group.' },
    ],
  }),
});

function BlogsIndexPage() {
  return (
    <div className="w-full bg-[var(--background)] min-h-screen text-[var(--foreground)] pt-32 pb-24 px-6 md:px-12 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-[var(--gold)]/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-white/5 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="mb-16">
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 mb-6">
            Insights & News
          </h1>
          <p className="text-xl text-white/50 max-w-2xl leading-relaxed">
            Discover expert perspectives on real estate investment, modern construction, and property technology.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {BLOG_POSTS.map((post) => (
            <Link
              key={post.slug}
              to="/site/blogs/$slug"
              params={{ slug: post.slug }}
              className="group block rounded-3xl overflow-hidden bg-white/[0.02] border border-white/10 hover:bg-white/[0.04] transition-all duration-300 ease-spring active:scale-[0.98]"
            >
              <div className="aspect-[16/9] w-full overflow-hidden relative">
                <img
                  src={post.heroImage}
                  alt={post.title}
                  className="w-full h-full object-cover transform transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-60" />
              </div>
              
              <div className="p-8">
                <div className="flex items-center space-x-4 mb-4">
                  <span className="text-xs font-medium text-[var(--gold)] tracking-wider uppercase">
                    {post.date}
                  </span>
                  <span className="w-1 h-1 rounded-full bg-white/20" />
                  <span className="text-xs text-white/40">
                    {post.author}
                  </span>
                </div>
                
                <h2 className="text-xl md:text-2xl font-medium text-white mb-4 line-clamp-2 group-hover:text-[var(--gold)] transition-colors">
                  {post.title}
                </h2>
                
                <p className="text-white/50 text-sm leading-relaxed line-clamp-3">
                  {post.summary}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
