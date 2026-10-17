export type PostStatus = "draft" | "published";

export type Post = {
  id: string;
  author_id: string;
  slug: string;
  title: string;
  excerpt: string;
  content_md: string;
  tags: string[];
  category: string;
  status: PostStatus;
  learned_on: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PostInput = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  content_md: string;
  tags: string[];
  category: string;
  status: PostStatus;
  learned_on: string;
};
