import { createFileRoute, notFound } from '@tanstack/react-router';
import { getPostBySlug } from '../lib/blogData';

export const Route = createFileRoute('/site/blogs/$slug')({
  loader: ({ params: { slug } }) => {
    const post = getPostBySlug(slug);
    if (!post) {
      throw notFound();
    }
    return post;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: 'Blog Not Found | Precise Group' }],
      };
    }
    return {
      meta: [
        { title: loaderData.seoTitle },
        { name: 'description', content: loaderData.seoDescription },
        { property: 'og:title', content: loaderData.seoTitle },
        { property: 'og:description', content: loaderData.seoDescription },
        { property: 'og:image', content: loaderData.heroImage },
      ],
    };
  },
  component: BlogPostPage,
});

function BlogPostPage() {
  const post = Route.useLoaderData();

  return (
    <article className="w-full bg-[var(--background)] min-h-screen text-[var(--foreground)] pb-24 relative overflow-hidden selection:bg-[var(--gold)] selection:text-black">
      {/* Hero Section */}
      <div className="relative w-full h-[60vh] min-h-[500px]">
        <img
          src={post.heroImage}
          alt={post.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        
        <div className="absolute bottom-0 left-0 right-0 px-6 md:px-12 pb-16">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center space-x-4 mb-6">
              <span className="text-sm font-medium text-[var(--gold)] tracking-wider uppercase">
                {post.date}
              </span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span className="text-sm text-white/60">
                {post.author}
              </span>
            </div>
            
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-white mb-6 leading-[1.1]">
              {post.title}
            </h1>
            
            <p className="text-xl md:text-2xl text-white/70 font-light max-w-3xl leading-relaxed">
              {post.summary}
            </p>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="max-w-4xl mx-auto px-6 md:px-12 pt-16">
        <div 
          className="prose prose-invert prose-lg md:prose-xl max-w-none
                     prose-headings:font-medium prose-headings:tracking-tight prose-headings:text-white
                     prose-h2:text-3xl md:prose-h2:text-4xl prose-h2:mt-16 prose-h2:mb-8
                     prose-p:text-white/70 prose-p:leading-relaxed prose-p:mb-8
                     prose-strong:text-white prose-strong:font-medium
                     prose-ul:text-white/70 prose-li:mb-4
                     marker:text-[var(--gold)]"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
        
        <hr className="border-white/10 my-16" />
        
        <div className="flex items-center justify-between">
          <div className="text-white/50 text-sm tracking-wider uppercase">
            Share this article
          </div>
          <div className="flex space-x-4">
            <button className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors">
              <span className="sr-only">Share on Twitter</span>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
            </button>
            <button className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors">
              <span className="sr-only">Share on LinkedIn</span>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
