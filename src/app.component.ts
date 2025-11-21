import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  AfterViewInit,
  signal,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';

// Объявляем глобальную переменную ymaps, чтобы TypeScript не вызывал ошибку
declare const ymaps: any;

const GEOCODE_DELAY_MS = 200; // Задержка между запросами геокодирования
const SETTINGS_STORAGE_KEY = 'yandex-maps-settings';

// Интерфейс для настроек приложения
interface AppSettings {
  apiKey: string;
  retryCount: number;
  retryDelays: number[]; // в секундах
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;

  addressesInput = signal('');
  isSearching = signal(false);
  foundAddressesCount = signal(0);
  totalAddressesCount = signal(0);
  notFoundAddresses = signal<string[]>([]);
  mapError = signal<string | null>(null);
  mapInitialized = signal(false);

  // Настройки
  isSettingsOpen = signal(false);
  settings = signal<AppSettings>({
    apiKey: '',
    retryCount: 3,
    retryDelays: [1, 2, 4]
  });

  // Временные значения для формы настроек
  tempApiKey = signal('');
  tempRetryCount = signal(3);
  tempRetryDelays = signal('1, 2, 4');

  private map: any;
  private geoObjectsCollection: any;
  private searchCancelled = false;
  private yandexMapsScriptLoaded = false;

  ngAfterViewInit(): void {
    this.loadSettings();

    // Загружаем API только если ключ уже есть
    if (this.settings().apiKey) {
      this.loadYandexMapsScript();
    }
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.destroy();
    }
  }

  // Методы работы с настройками
  loadSettings(): void {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AppSettings;
        this.settings.set(parsed);
      } catch (error) {
        console.error('Ошибка при загрузке настроек:', error);
      }
    }

    // Если API ключа нет, открыть диалог настроек
    if (!this.settings().apiKey) {
      this.openSettings();
    }
  }

  openSettings(): void {
    const current = this.settings();
    this.tempApiKey.set(current.apiKey);
    this.tempRetryCount.set(current.retryCount);
    this.tempRetryDelays.set(current.retryDelays.join(', '));
    this.isSettingsOpen.set(true);
  }

  closeSettings(): void {
    this.isSettingsOpen.set(false);
  }

  saveSettings(): void {
    // Парсим задержки из строки
    const delays = this.tempRetryDelays()
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n) && n > 0);

    if (delays.length === 0) {
      alert('Ошибка: задержки должны быть положительными числами, разделёнными запятыми');
      return;
    }

    const newSettings: AppSettings = {
      apiKey: this.tempApiKey().trim(),
      retryCount: this.tempRetryCount(),
      retryDelays: delays
    };

    if (!newSettings.apiKey) {
      alert('Ошибка: введите API ключ Яндекс.Карт');
      return;
    }

    const oldApiKey = this.settings().apiKey;
    const apiKeyChanged = oldApiKey !== newSettings.apiKey;

    this.settings.set(newSettings);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    this.closeSettings();

    // Если ключ изменился, нужно перезагрузить страницу для загрузки нового API
    if (apiKeyChanged && oldApiKey) {
      alert('API ключ изменён. Страница будет перезагружена.');
      window.location.reload();
      return;
    }

    // Если карта ещё не инициализирована и скрипт не загружен, загружаем
    if (!this.mapInitialized() && !this.yandexMapsScriptLoaded) {
      this.loadYandexMapsScript();
    }
  }

  onApiKeyChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.tempApiKey.set(target.value);
  }

  onRetryCountChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.tempRetryCount.set(parseInt(target.value, 10));
  }

  onRetryDelaysChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.tempRetryDelays.set(target.value);
  }

  // Динамическая загрузка Яндекс.Карт API
  private loadYandexMapsScript(): void {
    // Если скрипт уже загружен, просто инициализируем карту
    if (this.yandexMapsScriptLoaded || typeof ymaps !== 'undefined') {
      this.initializeMapWithRetry();
      return;
    }

    const apiKey = this.settings().apiKey;
    if (!apiKey) {
      this.mapError.set('API ключ не настроен. Откройте настройки и введите ключ.');
      return;
    }

    // Создаём <script> элемент
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`;
    script.type = 'text/javascript';
    script.async = true;

    script.onload = () => {
      this.yandexMapsScriptLoaded = true;
      this.mapError.set(null);
      this.initializeMapWithRetry();
    };

    script.onerror = () => {
      this.yandexMapsScriptLoaded = false;
      this.mapError.set('Ошибка загрузки Яндекс.Карт API. Проверьте API ключ в настройках и подключение к интернету.');
    };

    document.head.appendChild(script);
  }

  private initializeMapWithRetry(): void {
    let attempts = 0;
    const intervalId = setInterval(() => {
        if (typeof ymaps !== 'undefined' && ymaps.ready) {
            clearInterval(intervalId);
            this.initializeMap();
        } else {
            attempts++;
            if (attempts > 30) { // wait up to 3 seconds
                clearInterval(intervalId);
                this.mapError.set('Не удалось загрузить API Яндекс Карт. Проверьте, что вы заменили "YOUR_YANDEX_MAPS_API_KEY" в index.html и попробуйте обновить страницу.');
            }
        }
    }, 100);
  }

  private initializeMap(): void {
    ymaps.ready()
      .then(() => {
        this.map = new ymaps.Map(this.mapContainer.nativeElement, {
          center: [55.751574, 37.573856], // Центр Москвы
          zoom: 10,
          controls: ['zoomControl', 'fullscreenControl']
        });
        this.geoObjectsCollection = new ymaps.GeoObjectCollection({}, {});
        this.map.geoObjects.add(this.geoObjectsCollection);
        this.mapInitialized.set(true);
      })
      .catch((err: any) => {
        console.error('Ошибка инициализации карты:', err);
        this.mapError.set('Произошла ошибка при инициализации карты. Проверьте консоль для деталей.');
      });
  }

  onAddressesChange(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.addressesInput.set(target.value);
  }

  toggleSearch(): void {
    if (this.isSearching()) {
      this.stopSearch();
    } else {
      this.startSearch();
    }
  }

  private stopSearch(): void {
    this.searchCancelled = true;
    this.isSearching.set(false);
  }

  // Геокодирование с retry логикой
  private async geocodeWithRetry(address: string): Promise<any> {
    const { retryCount, retryDelays } = this.settings();
    let lastError: any = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      // Проверяем, не отменил ли пользователь поиск
      if (this.searchCancelled) {
        throw new Error('Поиск отменён пользователем');
      }

      try {
        // Первая попытка: поиск в видимой области карты
        let geocodeResult = await ymaps.geocode(address, {
          boundedBy: this.map.getBounds()
        });
        let firstGeoObject = geocodeResult.geoObjects.get(0);

        // Вторая попытка: глобальный поиск
        if (!firstGeoObject) {
          geocodeResult = await ymaps.geocode(address);
          firstGeoObject = geocodeResult.geoObjects.get(0);
        }

        return firstGeoObject;
      } catch (error: any) {
        lastError = error;

        // Проверяем на ошибки API ключа (401, 403)
        if (error?.status === 401 || error?.status === 403 ||
            error?.message?.includes('Invalid key') || error?.message?.includes('API key')) {
          this.mapError.set('Неверный API ключ. Откройте настройки и проверьте ключ.');
          throw error; // Не ретраим при ошибке ключа
        }

        // Если это не последняя попытка, делаем паузу
        if (attempt < retryCount) {
          const delaySeconds = retryDelays[Math.min(attempt, retryDelays.length - 1)];
          console.warn(`Ошибка геокодирования для "${address}" (попытка ${attempt + 1}/${retryCount + 1}). Повтор через ${delaySeconds}с...`);
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
      }
    }

    // Если все попытки исчерпаны
    console.error(`Не удалось геокодировать адрес "${address}" после ${retryCount + 1} попыток:`, lastError);
    throw lastError;
  }

  private async startSearch(): Promise<void> {
    if (!this.mapInitialized()) {
      alert('Карта еще не инициализирована. Пожалуйста, подождите.');
      return;
    }

    this.isSearching.set(true);
    this.searchCancelled = false;
    this.geoObjectsCollection.removeAll();
    this.foundAddressesCount.set(0);
    this.notFoundAddresses.set([]);
    
    const addresses = this.addressesInput()
      .split('\n')
      .map(addr => addr.trim())
      .filter(addr => addr.length > 0);

    this.totalAddressesCount.set(addresses.length);
    
    if (addresses.length === 0) {
      this.isSearching.set(false);
      return;
    }

    for (let i = 0; i < addresses.length; i++) {
      if (this.searchCancelled) {
        console.log('Поиск остановлен пользователем.');
        break;
      }

      const address = addresses[i];
      try {
        const firstGeoObject = await this.geocodeWithRetry(address);

        if (firstGeoObject) {
          const coords = firstGeoObject.geometry.getCoordinates();
          const foundAddress = firstGeoObject.getAddressLine();
          this.addPlacemark(coords, i + 1, address, foundAddress);
          this.foundAddressesCount.update(n => n + 1);
        } else {
          console.warn(`Адрес не найден: ${address}`);
          this.notFoundAddresses.update(arr => [...arr, address]);
        }
      } catch (error) {
        let errorMessage: string;
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'object' && error !== null) {
            errorMessage = JSON.stringify(error, null, 2);
        } else {
            errorMessage = String(error);
        }
        console.error(`Ошибка геокодирования для адреса "${address}":`, errorMessage);
        this.notFoundAddresses.update(arr => [...arr, address]);

        // Если ошибка API ключа, останавливаем поиск
        if (this.mapError()) {
          this.stopSearch();
          break;
        }
      }

      // Пауза между запросами
      await new Promise(resolve => setTimeout(resolve, GEOCODE_DELAY_MS));
    }
    
    if (this.geoObjectsCollection.getLength() > 0) {
        this.map.setBounds(this.geoObjectsCollection.getBounds(), {
            checkZoomRange: true,
            zoomMargin: 35
        });
    }

    this.isSearching.set(false);
  }

  private addPlacemark(coords: number[], index: number, originalAddress: string, foundAddress: string): void {
    const placemark = new ymaps.Placemark(coords, {
      iconContent: index,
      balloonContentHeader: `Маркер №${index}`,
      balloonContentBody: `
        <div class="text-sm">
          <p><strong>Исходный адрес:</strong><br>${originalAddress}</p>
          <hr class="my-2">
          <p><strong>Найденный адрес:</strong><br>${foundAddress}</p>
        </div>
      `
    }, {
      preset: 'islands#blueStretchyIcon',
      // preset: 'islands#violetIcon',
      draggable: false
    });

    this.geoObjectsCollection.add(placemark);
  }
}
