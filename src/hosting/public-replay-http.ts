type PublicReplayAdmissionErrorCode = "DEMO_BUSY" | "DEMO_CAPACITY_REACHED";

const publicReplayAdmissionErrors = {
  DEMO_BUSY: {
    status: 429,
    message: "Public replay is busy. Try again shortly.",
  },
  DEMO_CAPACITY_REACHED: {
    status: 503,
    message: "Public replay capacity was reached. Try again after the service restarts.",
  },
} as const satisfies Record<
  PublicReplayAdmissionErrorCode,
  { readonly status: number; readonly message: string }
>;

export function publicReplayErrorResponse(code: PublicReplayAdmissionErrorCode): Response {
  const error = publicReplayAdmissionErrors[code];
  return Response.json(
    {
      error: {
        code,
        message: error.message,
      },
    },
    { status: error.status },
  );
}

export function publicReplayInvalidRequestResponse(): Response {
  return Response.json(
    {
      error: {
        code: "INVALID_REQUEST",
        message: "Only the certified public replay request is supported.",
      },
    },
    { status: 400 },
  );
}
