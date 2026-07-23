import { describe, expect, it, vi } from "vitest";
import { BookingComApiError, BookingComClient } from "./bookingComClient.js";

describe("BookingComClient", () => {
  it("exchanges token-based machine credentials without putting them in the URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ jwt: "jwt-token", ruid: "ruid-1" }), { status: 200 }),
    );
    const client = new BookingComClient(fetchMock);

    await expect(client.exchangeToken({ clientId: "client-1", clientSecret: "secret-1" })).resolves.toEqual({
      jwt: "jwt-token",
      ruid: "ruid-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://connectivity-authentication.booking.com/token-based-authentication/exchange");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ client_id: "client-1", client_secret: "secret-1" }));
  });

  it("uses the secure Booking.com host for reservation retrieval", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("<reservations />", { status: 200 }));
    const client = new BookingComClient(fetchMock);

    await client.getReservationsSummary("jwt-token", 123456);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://secure-supply-xml.booking.com/hotels/xml/reservationssummary");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer jwt-token", "Content-Type": "application/xml" });
    expect(init?.body).toBe("<request><hotel_id>123456</hotel_id></request>");
  });

  it("returns a safe provider error without exposing the submitted secret", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "401", message: "Invalid credentials" }), { status: 401 }),
    );
    const client = new BookingComClient(fetchMock);

    const error = await client.exchangeToken({ clientId: "client-1", clientSecret: "do-not-leak-this" }).catch((value) => value);
    expect(error).toBeInstanceOf(BookingComApiError);
    expect((error as Error).message).toContain("Invalid credentials");
    expect((error as Error).message).not.toContain("do-not-leak-this");
  });

  it("does not truncate successful reservation responses", async () => {
    const body = `<reservations>${"x".repeat(8_000)}</reservations>`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const client = new BookingComClient(fetchMock);

    await expect(client.getReservationsSummary("jwt-token", 123456)).resolves.toMatchObject({ body });
  });

  it("supports an isolated test environment and test acknowledgement target", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("<success />", { status: 200 }));
    const client = new BookingComClient(fetchMock, {
      secureSupplyUrl: "https://booking.test.local/",
      target: "Test",
    });

    await client.acknowledgeReservations("jwt-token", ["reservation-1"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://booking.test.local/hotels/ota/OTA_HotelResNotif");
    expect(String(init?.body)).toContain('Target="Test"');
  });
});
