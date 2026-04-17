import { useParams } from 'react-router-dom';

export default function SportPage() {
  const { slug } = useParams();

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight mb-4">
        Sport: {slug}
      </h1>
      <p className="text-muted-foreground">
        Markets for this sport will appear here.
      </p>
    </div>
  );
}
