import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, map } from "rxjs";

import {
  Departure,
  Dictionary,
} from "../models/departure.model";

import { SingleBoardResponse } from "../models/singleboard-response.model";

interface WorkerStop {
  agency: string;
  stopCode: string;
  name: string;
}

interface WorkerDeparture {
  route: string;
  destination: string;

  expectedDeparture: string | null;
  scheduledDeparture: string | null;

  minutes: number | null;
  displayTime: string;

  vehicleRef: string | null;
  tripRef: string | null;
  directionRef: string | null;

  platform: string;
  status: string;

  stop?: WorkerStop;
}

interface WorkerStopGroup {
  agency: string;
  stopCode: string;
  name: string;
  count: number;
  departures: WorkerDeparture[];
}

interface WorkerError {
  stopCode: string;
  error: string;
}

interface WorkerResponse {
  ok: boolean;
  generatedAt: string;

  agency?: string;

  stop?: WorkerStop;
  stops?: WorkerStopGroup[];

  requestedStops?: string[];

  count: number;
  departures: WorkerDeparture[];

  errors?: WorkerError[];
  error?: string;
}

@Injectable({
  providedIn: "root",
})
export class DepartureService {
  /*
   * Replace this URL with your actual Cloudflare Worker URL.
   *
   * Do not add:
   * ?stop=
   * ?stops=
   * or a trailing query string.
   */
  private readonly workerUrl =
    "https://led-departure-api.261bayley.workers.dev";

  constructor(private http: HttpClient) {}

  GetDepartures(
    stationCode: string,
    displays: number,
    useArrivals: boolean,
    platform: string = null,
    dataSource: string = null,
    toCrsCode: string = null,
    includeStopData: boolean = null
  ): Observable<Departure[]> {
    const stopCodes = this.cleanStopCodes(stationCode);
    const numberOfDepartures = displays || 10;

    const params: Record<string, string> = {
      stops: stopCodes,
      limit: String(numberOfDepartures),
      totalLimit: String(numberOfDepartures),
    };

    /*
     * The Worker defaults to agency SF.
     *
     * This means the board will use San Francisco Muni unless
     * an agency is supplied through dataSource.
     */
    if (dataSource) {
      params.agency = dataSource;
    }

    return this.http
      .get<WorkerResponse>(this.workerUrl, {
        params,
      })
      .pipe(
        map((response) => {
          this.checkResponse(response);

          return response.departures
            .slice(0, numberOfDepartures)
            .map((departure) =>
              this.convertDeparture(
                departure,
                response,
                stopCodes
              )
            );
        })
      );
  }

  GetSingleboardDepartures(
    stationCode: string,
    useArrivals: boolean,
    platform: string = null,
    toCrsCode: string = null
  ): Observable<SingleBoardResponse> {
    const stopCodes = this.cleanStopCodes(stationCode);

    const params: Record<string, string> = {
      stops: stopCodes,
      limit: "20",
      totalLimit: "50",
    };

    return this.http
      .get<WorkerResponse>(this.workerUrl, {
        params,
      })
      .pipe(
        map((response) => {
          this.checkResponse(response);

          const departures = response.departures.map(
            (departure) =>
              this.convertDeparture(
                departure,
                response,
                stopCodes
              )
          );

          const information =
            response.errors && response.errors.length > 0
              ? response.errors
                  .map(
                    (error) =>
                      `Stop ${error.stopCode}: ${error.error}`
                  )
                  .join(" | ")
              : "";

          return {
            departures,
            information,
          };
        })
      );
  }

  private convertDeparture(
    source: WorkerDeparture,
    response: WorkerResponse,
    requestedStops: string
  ): Departure {
    const stop = this.getDepartureStop(
      source,
      response,
      requestedStops
    );

    const aimedDeparture = this.toDate(
      source.scheduledDeparture
    );

    const expectedDeparture = this.toDate(
      source.expectedDeparture
    );

    const extraDetails: any = {
      route: source.route || "",
      minutes:
        source.minutes === null
          ? ""
          : source.minutes,
      displayTime: source.displayTime || "",
      vehicleRef: source.vehicleRef || "",
      tripRef: source.tripRef || "",
      directionRef: source.directionRef || "",
      agency: stop.agency || "SF",
      stopCode: stop.stopCode,
      stopName: stop.name,
    };

    return {
      lastUpdated:
        response.generatedAt ||
        new Date().toISOString(),

      stationName:
        stop.name ||
        `Stop ${stop.stopCode}`,

      stationCode:
        stop.stopCode ||
        requestedStops,

      platform:
        source.platform || "",

      operatorName:
        source.route ||
        stop.agency ||
        "Transit",

      aimedDeparture,

      expectedDeparture,

      origin:
        stop.name ||
        `Stop ${stop.stopCode}`,

      destination:
        source.destination ||
        "Unknown destination",

      status:
        source.status ||
        this.createCountdownStatus(
          source.minutes
        ),

      length: 0,

      stops: [],

      extraDetails,

      isCancelled: false,
    };
  }

  private getDepartureStop(
    source: WorkerDeparture,
    response: WorkerResponse,
    requestedStops: string
  ): WorkerStop {
    if (source.stop) {
      return source.stop;
    }

    if (response.stop) {
      return response.stop;
    }

    const firstRequestedStop =
      requestedStops.split(",")[0] || requestedStops;

    return {
      agency: response.agency || "SF",
      stopCode: firstRequestedStop,
      name: `Stop ${firstRequestedStop}`,
    };
  }

  private createCountdownStatus(
    minutes: number | null
  ): string {
    if (minutes === null) {
      return "";
    }

    if (minutes <= 0) {
      return "Due";
    }

    if (minutes === 1) {
      return "1 min";
    }

    return `${minutes} mins`;
  }

  private cleanStopCodes(
    stationCode: string
  ): string {
    return String(stationCode || "")
      .split(",")
      .map((stopCode) => stopCode.trim())
      .filter(Boolean)
      .join(",");
  }

  private toDate(
    value: string | null
  ): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return date;
  }

  private checkResponse(
    response: WorkerResponse
  ): void {
    if (!response) {
      throw new Error(
        "The departure API returned no response."
      );
    }

    if (!response.ok) {
      throw new Error(
        response.error ||
          "The departure API returned an error."
      );
    }

    if (!Array.isArray(response.departures)) {
      throw new Error(
        "The departure API did not return a departures list."
      );
    }
  }
}
