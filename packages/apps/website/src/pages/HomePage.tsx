export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Final Score
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Sports Prediction Markets — powered by the Internet Computer
        </p>
        <div className="pt-4">
          <img 
            src="/banner-final-score.webp" 
            alt="Final Score Banner" 
            className="mx-auto rounded-xl max-w-3xl w-full shadow-lg"
          />
        </div>
      </div>
    </div>
  );
}
