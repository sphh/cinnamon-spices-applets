export {}; // Declaring as a Module

function importModule(path: string): any {
    if (typeof require !== 'undefined') {
      return require('./' + path);
    } else {
      if (!AppletDir) var AppletDir = imports.ui.appletManager.applets['weather@mockturtl'];
      return AppletDir[path];
    }
  }

var utils = importModule("utils");
var isCoordinate = utils.isCoordinate as (text: any) => boolean;
var isLangSupported = utils.isLangSupported as (lang: string, languages: Array <string> ) => boolean;
var FahrenheitToKelvin = utils.FahrenheitToKelvin as (fahr: number) => number;
var CelsiusToKelvin = utils.CelsiusToKelvin as (celsius: number) => number;
var MPHtoMPS = utils.MPHtoMPS as (speed: number) => number;
var icons = utils.icons;
var weatherIconSafely = utils.weatherIconSafely as (code: string[], icon_type: string) => string;

//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
///////////                                       ////////////
///////////                DarkSky                ////////////
///////////                                       ////////////
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////

class DarkSky implements WeatherProvider {

    //--------------------------------------------------------
    //  Properties
    //--------------------------------------------------------
    descriptionLinelength = 25;
    supportedLanguages = [
        'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es',
        'et', 'fi', 'fr', 'he', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'ka', 'ko',
        'kw', 'lv', 'nb', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
        'sv', 'tet', 'tr', 'uk', 'x-pig-latin', 'zh', 'zh-tw'];

    query = "https://api.darksky.net/forecast/";

      // DarkSky Filter words for short conditions, won't work on every language
    DarkSkyFilterWords = [_("and"), _("until"), _("in")];
    
    unit: queryUnits = null;

    app: WeatherApplet

    constructor(_app: WeatherApplet) {
        this.app = _app;
    }

    //--------------------------------------------------------
    //  Functions
    //--------------------------------------------------------
    async GetWeather(): Promise<boolean> {
        let query = this.ConstructQuery();
        let json;
        if (query != "" && query != null) {
            this.app.log.Debug("DarkSky API query: " + query);
            try {
                json = await this.app.LoadJsonAsync(query);
            }
            catch(e) {
                this.app.HandleHTTPError("darksky", e, this.app, this.HandleHTTPError);
                return false;
            }        
            
            if (!json) {
                this.app.HandleError({type: "soft", detail: "no api response", service: "darksky"});
                return false;
            }
         
            if (!json.code) {                   // No code, Request Success
                return this.ParseWeather(json);
            }
            else {
                this.HandleResponseErrors(json);
                return false;
            }
        }
        return false;
    };


    ParseWeather(json: any): boolean {
        try {
            // Current Weather
            this.app.weather.dateTime = new Date(json.currently.time * 1000);
            this.app.weather.location.timeZone = json.timezone;
            this.app.weather.coord.lat = json.latitude;
            this.app.weather.coord.lon = json.longitude;
            this.app.weather.sunrise = new Date(json.daily.data[0].sunriseTime * 1000);
            this.app.weather.sunset = new Date(json.daily.data[0].sunsetTime * 1000);
            this.app.weather.wind.speed = this.ToMPS(json.currently.windSpeed);
            this.app.weather.wind.degree = json.currently.windBearing;
            this.app.weather.main.temperature = this.ToKelvin(json.currently.temperature);
            this.app.weather.main.pressure = json.currently.pressure;
            this.app.weather.main.humidity = json.currently.humidity * 100;
                // Using Summary for both, only short description available
            this.app.weather.condition.main = this.GetShortCurrentSummary(json.currently.summary);        
            this.app.weather.condition.description = json.currently.summary;
            this.app.weather.condition.icon = weatherIconSafely(this.ResolveIcon(json.currently.icon), this.app._icon_type);
            this.app.weather.cloudiness = json.currently.cloudCover * 100;
            this.app.weather.main.feelsLike = this.ToKelvin(json.currently.apparentTemperature); //convert
            // Forecast
            for (let i = 0; i < this.app._forecastDays; i++) {
                // Object
                let forecast: Forecast = {          
                    dateTime: null,             //Required
                    main: {
                      temp: null,
                      temp_min: null,           //Required
                      temp_max: null,           //Required
                      pressure: null,
                      sea_level: null,
                      grnd_level: null,
                      humidity: null,
                    },
                    condition: {
                      id: null,
                      main: null,               //Required
                      description: null,        //Required
                      icon: null,               //Required
                    },
                    clouds: null,
                    wind: {
                      speed: null,
                      deg: null,
                    }
                  };
                  let day = json.daily.data[i];
                  forecast.dateTime = new Date(day.time * 1000);
                  // JS assumes time is local, so it applies the correct offset creating the Date (including Daylight Saving)
                  // but when using the date when daylight saving is active, it DOES NOT apply the DST back,
                  // So we offset the date to make it Noon
                  forecast.dateTime.setHours(forecast.dateTime.getHours() + 12);
                  forecast.main.temp_min = this.ToKelvin(day.temperatureLow);
                  forecast.main.temp_max = this.ToKelvin(day.temperatureHigh);
                  forecast.condition.main = this.GetShortSummary(day.summary);
                  forecast.condition.description = this.ProcessSummary(day.summary);
                  forecast.condition.icon = weatherIconSafely(this.ResolveIcon(day.icon), this.app._icon_type);
                  forecast.main.pressure = day.pressure;
                  forecast.main.humidity = day.humidity * 100;

                  this.app.forecasts.push(forecast);
            }
            return true;
        }
        catch(e) {
            this.app.log.Error("DarkSky payload parsing error: " + e)
            this.app.HandleError({type: "soft", detail: "unusal payload", service: "darksky", message: _("Failed to Process Weather Info")});
            return false;
        }
    };


    ConstructQuery(): string {
        this.SetQueryUnit();
        let query;
        let key = this.app._apiKey.replace(" ", "");
        let location = this.app._location.replace(" ", "");
        if (this.app.noApiKey()) {
            this.app.log.Error("DarkSky: No API Key given");
            this.app.HandleError({
                type: "hard",
                 noTriggerRefresh: true,
                  "detail": "no key",
                   message: _("Please enter API key in settings,\nor get one first on https://darksky.net/dev/register")});
            return "";
        }
        if (isCoordinate(location)) {
            query = this.query + key + "/" + location + 
            "?exclude=minutely,hourly,flags" + "&units=" + this.unit;
            this.app.log.Debug(this.app.systemLanguage);
            if (isLangSupported(this.app.systemLanguage, this.supportedLanguages) && this.app._translateCondition) {
                query = query + "&lang=" + this.app.systemLanguage;
            }
            return query;
        }
        else {
            this.app.log.Error("DarkSky: Location is not a coordinate");
            this.app.HandleError({type: "hard", detail: "bad location format", service:"darksky", noTriggerRefresh: true, message: ("Please Check the location,\nmake sure it is a coordinate") })
            return "";
        }
    };


    HandleResponseErrors(json: any): void {
        let code = json.code;
        let error = json.error;
        let errorMsg = "DarkSky API: "
        this.app.log.Debug("DarksSky API error payload: " + json);
        switch(code) {
            case "400":
                this.app.log.Error(errorMsg + error);
                break;
            default:
                this.app.log.Error(errorMsg + error);
                break
        }
    };

    /** Handles API Scpecific HTTP errors  */
    HandleHTTPError(error: HttpError, uiError: AppletError): AppletError {
        if (error.code == 403) { // DarkSky returns auth error on the http level when key is wrong
            uiError.detail = "bad key"
            uiError.message = _("Please Make sure you\nentered the API key correctly");
            uiError.type = "hard";
            uiError.noTriggerRefresh = true;
        }
        return uiError;
    }

    ProcessSummary(summary: string): string {
        let processed = summary.split(" ");
        let result = "";
        let linelength = 0;
        for (let i = 0; i < processed.length; i++) {
            if (linelength + processed[i].length > this.descriptionLinelength) {
                result = result + "\n";
                linelength = 0;
            }
            result = result + processed[i] + " ";
            linelength = linelength + processed[i].length + 1;
        }
        return result;
    };

    GetShortSummary(summary: string): string {
        let processed = summary.split(" ");
        let result = "";
        for (let i = 0; i < 2; i++) {
            if (!/[\(\)]/.test(processed[i]) && !this.WordBanned(processed[i])) {
                result = result + processed[i] + " ";
            }
        }
        return result;
    };

    GetShortCurrentSummary(summary: string): string {
        let processed = summary.split(" ");
        let result = "";
        let maxLoop;
        (processed.length < 2) ? maxLoop = processed.length : maxLoop = 2;
        for (let i = 0; i < maxLoop; i++) {
            if (processed[i] != "and") {
                result = result + processed[i] + " ";
            }
        }
        return result;
    }

    WordBanned(word: string): boolean {
        return this.DarkSkyFilterWords.indexOf(word) != -1;
    }

    ResolveIcon(icon: string): string[] {
        switch (icon) {
            case "rain":
              return [icons.rain, icons.showers_scattered, icons.rain_freezing]
            case "snow":
              return [icons.snow]
            case "fog":
              return [icons.fog]
           // case "04d":/* broken clouds day */
           //   return ['weather_overcast', 'weather-clouds', "weather-few-clouds"]
            //case "04n":/* broken clouds night */
            //  return ['weather_overcast', 'weather-clouds', "weather-few-clouds-night"]
           // case "03n":/* mostly cloudy (night) */
           //   return ['weather-clouds-night', 'weather-few-clouds-night']
            case "cloudy":/* mostly cloudy (day) */
              return [icons.overcast, icons.clouds, icons.few_clouds_day]
            case "partly-cloudy-night":
              return [icons.few_clouds_night, icons.few_clouds_day]
            case "partly-cloudy-day":
              return [icons.few_clouds_day]
            case "clear-night":
              return [icons.clear_night]
            case "clear-day":
              return [icons.clear_day]
            // Have not seen Storm or Showers icons returned yet
            case "storm":
              return [icons.storm]
            case "showers":
              return [icons.showers]
            // There is no guarantee that there is a wind icon
            case "wind":
                return ["weather-wind", "wind", "weather-breeze", icons.clouds, icons.few_clouds_day]
            default:
              return [icons.alert]
          }
    };

    SetQueryUnit(): void {
        if (this.app._temperatureUnit == "celsius"){
            if (this.app._windSpeedUnit == "kph" || this.app._windSpeedUnit == "m/s") {
                this.unit = 'si';
            }
            else {
                this.unit = 'uk2';
            }
        }
        else {
            this.unit = 'us';
        }
    };

    ToKelvin(temp: number): number {
        if (this.unit == 'us') {
            return FahrenheitToKelvin(temp);
        }
        else {
            return CelsiusToKelvin(temp);
        }

    };

    ToMPS(speed: number): number {
        if (this.unit == 'si') {
            return speed;
        }
        else {
            return MPHtoMPS(speed);
        }
    };
};

/**
 * - 'si' returns meter/sec and Celsius
 * - 'us' returns miles/hour and Farhenheit
 * - 'uk2' return miles/hour and Celsius
 */
type queryUnits = 'si' | 'us' | 'uk2';

