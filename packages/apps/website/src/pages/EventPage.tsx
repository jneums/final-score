import { useParams } from 'react-router-dom';

export default function EventPage() {
  const { slug } = useParams();

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight mb-4">
        Event: {slug}
      </h1>
      <p className="text-muted-foreground">
        Event details and prediction markets will appear here.
      </p>
    </div>
  );
}
