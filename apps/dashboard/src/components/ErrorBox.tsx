interface ErrorBoxProps {
  message: string;
  title?: string;
}

export function ErrorBox({ message, title }: ErrorBoxProps) {
  if (title) {
    return (
      <div className="text-sm text-red-400 bg-red-950/40 px-3 py-2 rounded-lg space-y-1 text-wrap overflow-hidden break-words w-full">
        <p className="font-semibold">{title}</p>
        <pre className="whitespace-pre-wrap break-all font-mono text-red-300">
          {message}
        </pre>
      </div>
    );
  }
  return (
    <p className="text-sm text-red-400 bg-red-950/40 px-3 py-2 rounded-lg text-wrap overflow-hidden break-words w-full">
      {message}
    </p>
  );
}
