"use client";

import Link from "next/link";
import { useCart } from "./cart";

export function CartLink() {
  const { count } = useCart();
  return (
    <Link href="/cart" className="btn-ghost">
      Cart
      {count > 0 && <span className="badge bg-accent text-white">{count}</span>}
    </Link>
  );
}
