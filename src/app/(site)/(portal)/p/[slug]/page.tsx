import { notFound } from "next/navigation";
import { PortableText, type PortableTextBlock } from "next-sanity";
import { getPage } from "@/sanity/content";

/** Pages admins write in the Studio: terms, FAQ, shipping policy… */
export default async function ContentPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
      <div className="space-y-3 leading-relaxed [&_a]:text-accent [&_a]:underline [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-6">
        <PortableText value={(page.body ?? []) as PortableTextBlock[]} />
      </div>
    </article>
  );
}
