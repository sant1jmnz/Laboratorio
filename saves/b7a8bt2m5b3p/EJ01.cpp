#include <iostream>
#include <fstream>
#include <cstring>
#include <string>

using namespace std;

struct Vehiculo {
    int id;
    char dominio[8];
    char marca[11];
};

struct Dinero {
    int dinero;
};

int idAutomatico(int ID) {
    return ID + 1;
}

int ObtenerUltimoID() {
    ifstream file("vehiculos.dat", ios::binary);
    Vehiculo v;
    int ultimoID = 0;
    if (file.is_open()) {
        while (file.read((char*)&v, sizeof(Vehiculo))) {
            ultimoID = v.id;
        }
        file.close();
    }
    return ultimoID;
}

int ObtenerUltimoDinero() {
    ifstream file("peaje.dat", ios::binary);
    Dinero d;
    int ultimoDinero = 0;
    if (file.is_open()) {
        while (file.read((char*)&d, sizeof(Dinero))) {
            ultimoDinero = d.dinero;
        }
        file.close();
    }
    return ultimoDinero;
}

void GuardarEnBinario(Vehiculo v) {
    ofstream file("vehiculos.dat", ios::binary | ios::app);
    if (file.is_open()) {
        file.write((char*)&v, sizeof(Vehiculo));
        file.close();
    }
}

void GuardarEnBinario(Dinero d) {
    ofstream file("peaje.dat", ios::binary | ios::app);
    if (file.is_open()) {
        file.write((char*)&d, sizeof(Dinero));
        file.close();
    }
}

bool validarOpcion(string pOpcion) {
    return (pOpcion >= "0" && pOpcion <= "3");
}

int main() {
    Dinero d;
    Vehiculo v;
    
    int id = ObtenerUltimoID();
    string opcion = "";
    d.dinero = ObtenerUltimoDinero(); 
    int tarifa = 3000;
    int auxCabina = 1;

    while (opcion != "0") {
        cout << "\n---- Cabina de peaje -----\n";
        cout << "1- Ingresar datos de vehiculo\n";
        cout << "2- Ver dinero recaudado y total de vehiculos\n";
        cout << "3- Cambiar flujo de cabina (Abrir/Cerrar)\n";
        cout << "0- Salir\n";
        cout << "Ingrese una opcion: ";
        cin >> opcion;
        cin.ignore();

        if (validarOpcion(opcion)) {
            if (opcion == "1") {
                if (auxCabina == 0) {
                    cout << "La cabina esta CERRADA. No se pueden registrar vehiculos.\n";
                } else {
                    id = idAutomatico(id);
                    v.id = id;

                    cout << "Ingrese el dominio de su auto: ";
                    cin.getline(v.dominio, 8);

                    cout << "Ingrese la marca de su auto: ";
                    cin.getline(v.marca, 11);

                    GuardarEnBinario(v);
                    cout << "Vehiculo guardado correctamente.\n";

                    d.dinero = d.dinero + tarifa;
                    GuardarEnBinario(d);
                }
            }
            else if (opcion == "2") {
                int recaudado = ObtenerUltimoDinero();
                cout << "Dinero recaudado hasta ahora: $" << recaudado << endl;
                cout << "Autos que pasaron por la cabina: " << recaudado / tarifa << endl;
            }
            else if (opcion == "3") {
                if (auxCabina == 1) {
                    auxCabina = 0;
                    cout << "Estado actual de la cabina: CERRADA" << endl;
                } else {
                    auxCabina = 1;
                    cout << "Estado actual de la cabina: ABIERTA" << endl;
                }
            }
        } else {
            cout << "Opcion invalida. Intente nuevamente." << endl;
        }
    }
    return 0;
}